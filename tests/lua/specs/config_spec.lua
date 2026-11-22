return function(t)
    local configmod = require("config")
    local cachemod = require("cache")
    local json = require("json")

    local html = t.read_file(t.root .. "/tests/fixtures/ig-search-page.html")

    t.test("config: parses appid, key and index prefix from the search page", function()
        local config, err = configmod.parse_search_page(html)
        t.assert_nil(err)
        t.assert_not_nil(config)
        t.assert_eq(config.appid, "TESTAPPID")
        t.assert_eq(config.key, "test-only-search-key")
        t.assert_eq(config.prefix, "produits_")
    end)

    t.test("config: accepts double-quoted values and trims whitespace", function()
        local page = [[<script>
            window.algoliaConfig = {
                algolia_appid: "  APPID  ",
                algolia_key: "KEY",
                algolia_index: "prefix_",
            };
        </script>]]
        local config, err = configmod.parse_search_page(page)
        t.assert_nil(err)
        t.assert_eq(config.appid, "APPID")
        t.assert_eq(config.key, "KEY")
        t.assert_eq(config.prefix, "prefix_")
    end)

    t.test("config: rejects pages without the Algolia block", function()
        local config, err = configmod.parse_search_page("<html><body>nope</body></html>")
        t.assert_nil(config)
        t.assert_eq(err, "config_not_found")
    end)

    t.test("config: rejects empty input", function()
        local config, err = configmod.parse_search_page("")
        t.assert_nil(config)
        t.assert_eq(err, "empty_page")
    end)

    t.test("config: country -> storefront language", function()
        t.assert_eq(configmod.language_for("DE"), "de")
        t.assert_eq(configmod.language_for("AT"), "de")
        t.assert_eq(configmod.language_for("fr"), "fr")
        t.assert_eq(configmod.language_for("BR"), "pt")
        t.assert_eq(configmod.language_for("PL"), "pl")
        t.assert_eq(configmod.language_for("US"), "en")
        -- RU/TR localized indexes are not published (verified 404): English.
        t.assert_eq(configmod.language_for("RU"), "en")
        t.assert_eq(configmod.language_for("TR"), "en")
        t.assert_eq(configmod.language_for(nil), "en")
    end)

    t.test("config: builds the spotlighted_desc index, adding a missing underscore", function()
        t.assert_eq(configmod.build_index("produits_", "en"), "produits_en_spotlighted_desc")
        t.assert_eq(configmod.build_index("produits", "de"), "produits_de_spotlighted_desc")
        t.assert_eq(configmod.build_index("produits_", "fr"), "produits_fr_spotlighted_desc")
    end)

    t.test("config: discovery is cached for 24h and refetched after expiry", function()
        local read, _, advance = t.clock(1000)
        local logger = t.fake_logger()
        local fs = t.mem_fs()
        local cache = cachemod.new({ json = json, fs = fs, dir = "/data", clock = read, logger = logger })
        local counter = { count = 0, urls = {} }
        local http = {
            get = function(self, url, headers)
                counter.count = counter.count + 1
                counter.urls[#counter.urls + 1] = url
                counter.headers = headers
                return { status = 200, body = html }
            end,
        }
        local store = configmod.new({
            http_client = http,
            cache = cache,
            clock = read,
            logger = logger,
        })

        local config = store:get("DE")
        t.assert_not_nil(config)
        t.assert_eq(config.index, "produits_de_spotlighted_desc")
        t.assert_eq(config.fetched_at, 1000)
        t.assert_eq(counter.count, 1)
        t.assert_eq(counter.urls[1], configmod.DEFAULT_SEARCH_URL)
        t.assert_contains(counter.headers["Accept"], "text/html")

        -- Fresh cache: no request, and the index is selected for the country.
        local cached = store:get("FR")
        t.assert_eq(counter.count, 1)
        t.assert_eq(cached.index, "produits_fr_spotlighted_desc")

        advance(24 * 3600)
        store:get("DE")
        t.assert_eq(counter.count, 1, "still fresh at exactly 24h")

        advance(1)
        store:get("DE")
        t.assert_eq(counter.count, 2, "refetched after 24h")
    end)

    t.test("config: refresh forces a network fetch", function()
        local read = t.clock(1000)
        local logger = t.fake_logger()
        local cache = cachemod.new({
            json = json,
            fs = t.mem_fs(),
            dir = "/data",
            clock = read,
            logger = logger,
        })
        local calls = 0
        local http = {
            get = function()
                calls = calls + 1
                return { status = 200, body = html }
            end,
        }
        local store = configmod.new({ http_client = http, cache = cache, clock = read, logger = logger })

        store:get("DE")
        t.assert_eq(calls, 1)
        local ok, index = store:refresh("DE")
        t.assert_true(ok)
        t.assert_eq(index, "produits_de_spotlighted_desc")
        t.assert_eq(calls, 2)
    end)

    t.test("config: HTTP failure surfaces an error without throwing", function()
        local read = t.clock(1000)
        local logger = t.fake_logger()
        local cache = cachemod.new({
            json = json,
            fs = t.mem_fs(),
            dir = "/data",
            clock = read,
            logger = logger,
        })
        local store = configmod.new({
            http_client = {
                get = function()
                    return { status = 503, body = "unavailable" }
                end,
            },
            cache = cache,
            clock = read,
            logger = logger,
        })
        local config, err = store:get("US")
        t.assert_nil(config)
        t.assert_eq(err, "http_503")
    end)

    t.test("config: last_index is restored from the config cache", function()
        local read = t.clock(1000)
        local logger = t.fake_logger()
        local cache = cachemod.new({
            json = json,
            fs = t.mem_fs(),
            dir = "/data",
            clock = read,
            logger = logger,
        })
        local store = configmod.new({ http_client = {}, cache = cache, clock = read, logger = logger })
        cache:set_config({
            appid = "APP",
            key = "KEY",
            prefix = "produits_",
            index = "produits_en_spotlighted_desc",
            fetched_at = 1000,
        })
        t.assert_eq(store:last_index(), "produits_en_spotlighted_desc")
    end)
end
