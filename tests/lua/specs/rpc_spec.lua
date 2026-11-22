return function(t)
    local rpc = require("rpc_functions")
    local json = require("json")

    t.test("rpc: registers the four global entry points", function()
        t.assert_eq(type(get_prices), "function")
        t.assert_eq(type(clear_cache), "function")
        t.assert_eq(type(get_status), "function")
        t.assert_eq(type(refresh_config), "function")
    end)

    t.test("rpc: delegates to the installed service", function()
        local service = {
            get_prices = function(self, request)
                return {
                    results = { { appid = request.games[1].appid, status = "matched" } },
                    fetched_at = 123,
                }
            end,
            clear_cache = function()
                return { ok = true }
            end,
            get_status = function()
                return {
                    algolia_index = "produits_en_spotlighted_desc",
                    config_age_seconds = 5,
                    cached_games = 2,
                    cache_ttl_seconds = 43200,
                }
            end,
            refresh_config = function()
                return { ok = true, index = "produits_en_spotlighted_desc" }
            end,
        }
        rpc.install(service)

        local response = get_prices({
            games = { { appid = 9, name = "Elden Ring" } },
            country = "DE",
            currency = "EUR",
        })
        t.assert_eq(response.fetched_at, 123)
        t.assert_eq(response.results[1].appid, 9)
        t.assert_eq(response.results[1].status, "matched")

        t.assert_true(clear_cache().ok)
        t.assert_eq(get_status().cached_games, 2)
        t.assert_eq(refresh_config().index, "produits_en_spotlighted_desc")
    end)

    t.test("rpc: service errors are converted into per-game errors", function()
        rpc.install({
            get_prices = function()
                error("boom")
            end,
        })
        local response = get_prices({
            games = {
                { appid = 1, name = "A" },
                { appid = 2, name = "B" },
            },
            country = "DE",
            currency = "EUR",
        })
        t.assert_eq(#response.results, 2)
        t.assert_eq(response.results[1].appid, 1)
        t.assert_eq(response.results[1].status, "error")
        t.assert_contains(response.results[1].error, "boom")
        t.assert_eq(response.results[2].appid, 2)
        t.assert_eq(response.results[2].status, "error")
    end)

    t.test("rpc: missing service returns contract-shaped failures", function()
        rpc.install(nil)

        local response = get_prices({
            games = { { appid = 3, name = "C" } },
            country = "DE",
            currency = "EUR",
        })
        t.assert_eq(#response.results, 1)
        t.assert_eq(response.results[1].status, "error")
        t.assert_eq(response.results[1].error, "backend_not_ready")

        t.assert_false(clear_cache().ok)
        t.assert_true(get_status().algolia_index == json.null)
        local refresh = refresh_config()
        t.assert_false(refresh.ok)
        t.assert_eq(refresh.error, "backend_not_ready")
    end)
end
