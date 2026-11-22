return function(t)
    local apimod = require("api")
    local algoliamod = require("algolia")
    local cachemod = require("cache")
    local matchingmod = require("matching")
    local configmod = require("config")
    local httpclient = require("http_client")
    local json = require("json")

    local fixture_text = t.read_file(t.root .. "/tests/fixtures/algolia-elden-ring.json")

    local function decode_term(body)
        local params = json.decode(body).params or ""
        local encoded = params:match("query=([^&]*)") or ""
        return (
            encoded:gsub("%%(%x%x)", function(hex)
                return string.char(tonumber(hex, 16))
            end)
        )
    end

    local function make_algolia_http(responses)
        responses = responses or {}
        local state = { calls = {} }
        local http = {
            post = function(self, url, body, headers)
                local term = decode_term(body)
                state.calls[#state.calls + 1] = { term = term, url = url, headers = headers }
                local behavior = responses[term]
                if behavior == nil then
                    return { status = 200, body = '{"hits":[]}' }
                end
                if type(behavior) == "function" then
                    return behavior(#state.calls, url, term)
                end
                return behavior
            end,
        }
        return http, state
    end

    local function make_config(options)
        options = options or {}
        local default_config = {
            appid = "APP",
            key = "KEY",
            prefix = "produits_",
            index = options.index or "produits_en_spotlighted_desc",
            fetched_at = 1000,
        }
        local state = { refreshes = 0, gets = 0 }

        local config = {
            get = function(self, country)
                state.gets = state.gets + 1
                if options.get then
                    return options.get(country, state)
                end
                return default_config
            end,
            index_for = function(self, value, country)
                return value.index or configmod.build_index(value.prefix, configmod.language_for(country))
            end,
            refresh = function(self, country)
                state.refreshes = state.refreshes + 1
                if options.refresh then
                    return options.refresh(country, state)
                end
                return true, default_config.index
            end,
            last_index = function(self)
                return default_config.index
            end,
            language_for = function(country)
                return configmod.language_for(country)
            end,
            build_index = function(prefix, lang)
                return configmod.build_index(prefix, lang)
            end,
        }
        return config, state, default_config
    end

    local function make_api(options)
        options = options or {}
        local read, set, advance = t.clock(options.start or 1000)
        local fs = options.fs or t.mem_fs()
        local logger = t.fake_logger()

        local cache = cachemod.new({
            json = json,
            fs = fs,
            dir = "/data",
            clock = read,
            logger = logger,
        })
        local config, config_state, default_config = make_config(options.config)
        if options.seed_config ~= false then
            cache:set_config({
                appid = default_config.appid,
                key = default_config.key,
                prefix = default_config.prefix,
                index = default_config.index,
                fetched_at = default_config.fetched_at,
            })
        end

        local http, algolia_state = make_algolia_http(options.responses)
        local algolia = algoliamod.new({ http_client = http, json = json, logger = logger })
        local matcher = matchingmod.new({ overrides = options.overrides or {}, logger = logger })

        local sleeps = {}
        local service = apimod.new({
            config = config,
            algolia = algolia,
            matching = matcher,
            cache = cache,
            json = json,
            clock = read,
            sleep = function(milliseconds)
                sleeps[#sleeps + 1] = milliseconds
            end,
            logger = logger,
        })

        return service, {
            cache = cache,
            algolia = algolia_state,
            config = config_state,
            fs = fs,
            sleeps = sleeps,
            read = read,
            set = set,
            advance = advance,
            logger = logger,
            config_default = default_config,
        }
    end

    local function base_request(games, overrides)
        local request = {
            games = games,
            country = "DE",
            currency = "EUR",
        }
        for key, value in pairs(overrides or {}) do
            request[key] = value
        end
        return request
    end

    t.test("api: preserves order, resolves duplicate appids once and caches per appid", function()
        local service, state = make_api({
            responses = { ["elden ring"] = { status = 200, body = fixture_text } },
        })

        local response = service:get_prices(base_request({
            { appid = 2, name = "elden ring" },
            { appid = 1, name = "unknown game" },
            { appid = 2, name = "elden ring" },
        }))

        t.assert_eq(#response.results, 3)
        t.assert_eq(response.results[1].appid, 2)
        t.assert_eq(response.results[1].status, "matched")
        t.assert_eq(response.results[1].product.prod_id, 4824)
        t.assert_eq(response.results[2].appid, 1)
        t.assert_eq(response.results[2].status, "no_match")
        t.assert_eq(response.results[3].appid, 2)
        t.assert_eq(response.results[3].status, "matched")

        local elden_queries = 0
        for _, call in ipairs(state.algolia.calls) do
            if call.term == "elden ring" then
                elden_queries = elden_queries + 1
            end
        end
        t.assert_eq(elden_queries, 1)
        t.assert_eq(state.cache:count_prices(), 2)
        t.assert_eq(#state.sleeps, 2, "one pause per unique query")
        t.assert_eq(state.sleeps[1], 60)
        t.assert_eq(type(response.fetched_at), "number")
    end)

    t.test("api: a failing game does not break the rest of the batch", function()
        local service, state = make_api({
            responses = {
                ["elden ring"] = { status = 200, body = fixture_text },
                explode = function()
                    return nil, "network down"
                end,
            },
        })

        local response = service:get_prices(base_request({
            { appid = 10, name = "elden ring" },
            { appid = 11, name = "explode" },
            { appid = 10, name = "elden ring" },
        }))

        t.assert_eq(response.results[1].status, "matched")
        t.assert_eq(response.results[2].status, "error")
        t.assert_eq(response.results[2].error, "network down")
        t.assert_eq(response.results[3].status, "matched")
        t.assert_eq(state.cache:count_prices(), 1, "errors are not cached")
    end)

    t.test("api: enforces the 100-game batch limit without losing result positions", function()
        local service, state = make_api()
        local games = {}
        for index = 1, 101 do
            games[index] = { appid = index, name = "unknown game" }
        end

        local response = service:get_prices(base_request(games))
        t.assert_eq(#response.results, 101)
        t.assert_eq(response.results[100].appid, 100)
        t.assert_eq(response.results[100].status, "no_match")
        t.assert_eq(response.results[101].appid, 101)
        t.assert_eq(response.results[101].status, "error")
        t.assert_eq(response.results[101].error, "batch_limit_exceeded")
        t.assert_eq(#state.algolia.calls, 100)
    end)

    t.test("api: fresh cache entries skip Algolia; force bypasses them", function()
        local service, state = make_api({
            responses = { ["elden ring"] = { status = 200, body = fixture_text } },
        })
        local request = base_request({ { appid = 1, name = "elden ring" } })

        service:get_prices(request)
        t.assert_eq(#state.algolia.calls, 1)

        service:get_prices(request)
        t.assert_eq(#state.algolia.calls, 1, "second call served from cache")
        t.assert_eq(#state.sleeps, 1)

        service:get_prices(base_request({ { appid = 1, name = "elden ring" } }, { force = true }))
        t.assert_eq(#state.algolia.calls, 2, "force bypasses the cache")
        t.assert_eq(#state.sleeps, 2)
    end)

    t.test("api: no_match is cached with the negative TTL and force refreshes it", function()
        local service, state = make_api()
        local request = base_request({ { appid = 5, name = "unknown game" } })

        service:get_prices(request)
        t.assert_eq(#state.algolia.calls, 1)
        service:get_prices(request)
        t.assert_eq(#state.algolia.calls, 1)

        state.advance(24 * 3600 + 1)
        service:get_prices(request)
        t.assert_eq(#state.algolia.calls, 2, "negative entry expired after 24h")
    end)

    t.test("api: out-of-stock is unavailable, preorder is matched", function()
        local out_of_stock = json.decode(fixture_text)
        out_of_stock.hits[1].has_stock = 0
        local service, _ = make_api({
            responses = {
                ["elden ring"] = { status = 200, body = json.encode(out_of_stock) },
            },
        })

        local response = service:get_prices(base_request({ { appid = 1, name = "elden ring" } }))
        t.assert_eq(response.results[1].status, "unavailable")
        t.assert_not_nil(response.results[1].product)
        t.assert_false(response.results[1].product.has_stock)

        local preorder = json.decode(fixture_text)
        preorder.hits[1].has_stock = 0
        preorder.hits[1].preorder = 1
        service = make_api({
            responses = {
                ["elden ring"] = { status = 200, body = json.encode(preorder) },
            },
        })
        response = service:get_prices(base_request({ { appid = 1, name = "elden ring" } }))
        t.assert_eq(response.results[1].status, "matched")
        t.assert_true(response.results[1].product.preorder)
    end)

    t.test("api: 403 refreshes the Algolia config and retries once", function()
        local call = 0
        local service, state = make_api({
            responses = {
                ["elden ring"] = function()
                    call = call + 1
                    if call == 1 then
                        return { status = 403, body = "Method not allowed with this referer" }
                    end
                    return { status = 200, body = fixture_text }
                end,
            },
        })

        local response = service:get_prices(base_request({ { appid = 1, name = "elden ring" } }))
        t.assert_eq(response.results[1].status, "matched")
        t.assert_eq(state.config.refreshes, 1)
        t.assert_eq(#state.algolia.calls, 2)
    end)

    t.test("api: a missing localized index falls back to English", function()
        local call = 0
        local service, state = make_api({
            config = { index = "produits_de_spotlighted_desc" },
            responses = {
                ["elden ring"] = function()
                    call = call + 1
                    if call == 1 then
                        return { status = 404, body = "index not found" }
                    end
                    return { status = 200, body = fixture_text }
                end,
            },
        })

        local response = service:get_prices(base_request({ { appid = 1, name = "elden ring" } }))
        t.assert_eq(response.results[1].status, "matched")
        t.assert_eq(#state.algolia.calls, 2)
        t.assert_contains(state.algolia.calls[2].url, "produits_en_spotlighted_desc/query")
        t.assert_eq(state.config.refreshes, 0)
    end)

    t.test("api: config failure is reported per game after one attempt", function()
        local service, state = make_api({
            config = {
                get = function()
                    return nil, "offline"
                end,
            },
        })

        local response = service:get_prices(base_request({
            { appid = 1, name = "elden ring" },
            { appid = 2, name = "other" },
        }))

        t.assert_eq(#response.results, 2)
        t.assert_eq(response.results[1].status, "error")
        t.assert_contains(response.results[1].error, "config_unavailable")
        t.assert_eq(response.results[2].status, "error")
        t.assert_eq(state.config.gets, 1)
        t.assert_eq(#state.algolia.calls, 0)
    end)

    t.test("api: invalid requests and games are isolated errors, never throws", function()
        local service = make_api()

        local response = service:get_prices(base_request({ { appid = 1, name = "x" } }, { country = "DEU" }))
        t.assert_eq(response.results[1].error, "invalid_country")

        response = service:get_prices(base_request({ { appid = 1, name = "x" } }, { currency = "EU" }))
        t.assert_eq(response.results[1].error, "invalid_currency")

        response = service:get_prices(base_request({}))
        t.assert_eq(#response.results, 0)

        response = service:get_prices(nil)
        t.assert_eq(#response.results, 0)

        response = service:get_prices(base_request({
            { appid = 0, name = "x" },
            { appid = 7 },
        }))
        t.assert_eq(response.results[1].error, "invalid_game")
        t.assert_eq(response.results[2].error, "invalid_game")
    end)

    t.test("api: negative synthetic packappids resolve by name", function()
        local service, state = make_api({
            responses = {
                ["DREDGE - Digital Deluxe Edition"] = { status = 200, body = fixture_text },
            },
        })

        local response = service:get_prices(base_request({
            { appid = -1001114568, name = "DREDGE - Digital Deluxe Edition" },
        }))

        t.assert_eq(response.results[1].appid, -1001114568)
        t.assert_eq(#state.algolia.calls, 1)
        t.assert_true(response.results[1].error ~= "invalid_game")
    end)

    t.test("api: status reports index, config age, cached games and TTL", function()
        local service, state = make_api({
            responses = { ["elden ring"] = { status = 200, body = fixture_text } },
        })

        local status = service:get_status()
        t.assert_eq(status.algolia_index, "produits_en_spotlighted_desc")
        t.assert_eq(status.config_age_seconds, 0)
        t.assert_eq(status.cached_games, 0)
        t.assert_eq(status.cache_ttl_seconds, 12 * 3600)

        state.advance(60)
        service:get_prices(base_request({ { appid = 1, name = "elden ring" } }))
        status = service:get_status()
        t.assert_eq(status.config_age_seconds, 60)
        t.assert_eq(status.cached_games, 1)
    end)

    t.test("api: status uses JSON null when there is no config cache", function()
        local service = make_api({ seed_config = false })
        local status = service:get_status()
        t.assert_true(status.config_age_seconds == json.null)
    end)

    t.test("api: clear_cache removes prices but keeps the config", function()
        local service, state = make_api({
            responses = { ["elden ring"] = { status = 200, body = fixture_text } },
        })
        service:get_prices(base_request({ { appid = 1, name = "elden ring" } }))
        t.assert_eq(state.cache:count_prices(), 1)

        local result = service:clear_cache()
        t.assert_true(result.ok)
        t.assert_eq(state.cache:count_prices(), 0)
        local config, age = state.cache:get_config_any()
        t.assert_not_nil(config, "config cache survives clear_cache")
        t.assert_eq(age, 0)
    end)

    t.test("api: refresh_config reports success and failure", function()
        local service, state = make_api()
        local result = service:refresh_config()
        t.assert_true(result.ok)
        t.assert_eq(result.index, "produits_en_spotlighted_desc")
        t.assert_eq(state.config.refreshes, 1)

        service = make_api({
            config = {
                refresh = function()
                    return false, "offline"
                end,
            },
        })
        result = service:refresh_config()
        t.assert_false(result.ok)
        t.assert_eq(result.error, "offline")
    end)

    t.test("api: end-to-end wiring with real config, algolia, matching and cache", function()
        local read = t.clock(2000)
        local logger = t.fake_logger()
        local cache = cachemod.new({
            json = json,
            fs = t.mem_fs(),
            dir = "/data",
            clock = read,
            logger = logger,
        })
        local html = t.read_file(t.root .. "/tests/fixtures/ig-search-page.html")

        local native = {
            request = function(url, options)
                if options.method == "GET" then
                    return { status = 200, body = html }
                end
                if options.method == "POST" then
                    t.assert_contains(url, "testappid-dsn.algolia.net")
                    t.assert_eq(options.headers["Origin"], "https://www.instant-gaming.com")
                    return { status = 200, body = fixture_text }
                end
                return { status = 500, body = "" }
            end,
        }

        local wrapper = httpclient.new({ http = native })
        local config_store = configmod.new({
            http_client = wrapper,
            cache = cache,
            clock = read,
            logger = logger,
        })
        local algolia_client = algoliamod.new({
            http_client = wrapper,
            json = json,
            logger = logger,
        })
        local matcher = matchingmod.new({})
        local service = apimod.new({
            config = config_store,
            algolia = algolia_client,
            matching = matcher,
            cache = cache,
            json = json,
            clock = read,
            sleep = function() end,
            logger = logger,
        })

        local response = service:get_prices(base_request({
            { appid = 1245620, name = "Elden Ring" },
        }))
        t.assert_eq(response.results[1].status, "matched")
        t.assert_eq(response.results[1].product.prod_id, 4824)
        t.assert_almost_eq(response.results[1].product.price, 45.99)

        local cached_config = cache:get_config_any()
        t.assert_not_nil(cached_config)
        t.assert_eq(cached_config.appid, "TESTAPPID")

        local status = service:get_status()
        t.assert_eq(status.algolia_index, "produits_de_spotlighted_desc")
        t.assert_eq(status.cached_games, 1)

        service:get_prices(base_request({ { appid = 1245620, name = "Elden Ring" } }, { force = true }))
        t.assert_eq(service:get_status().cached_games, 1)
    end)
end
