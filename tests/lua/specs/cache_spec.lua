return function(t)
    local cachemod = require("cache")
    local json = require("json")

    local function make_cache(options)
        options = options or {}
        local read, set, advance = t.clock(options.start or 1000)
        local fs = options.fs or t.mem_fs()
        local cache = cachemod.new({
            json = json,
            fs = fs,
            dir = options.dir or "/data",
            clock = read,
            logger = t.fake_logger(),
        })
        return cache, fs, read, set, advance
    end

    t.test("cache: matched results use the 12h price TTL", function()
        local cache, _, _, _, advance = make_cache()
        local result = { appid = 1, status = "matched", product = { price = 10 } }
        t.assert_true(cache:set_price(1, "DE", "EUR", result))
        t.assert_not_nil(cache:get_price(1, "DE", "EUR"))

        advance(12 * 3600)
        t.assert_not_nil(cache:get_price(1, "DE", "EUR"), "fresh at exactly 12h")

        advance(1)
        t.assert_nil(cache:get_price(1, "DE", "EUR"))
    end)

    t.test("cache: no_match uses the 24h negative TTL", function()
        local cache, _, _, _, advance = make_cache()
        cache:set_price(2, "DE", "EUR", { appid = 2, status = "no_match" })

        advance(20 * 3600)
        t.assert_not_nil(cache:get_price(2, "DE", "EUR"), "negative entry outlives the price TTL")

        advance(4 * 3600 + 1)
        t.assert_nil(cache:get_price(2, "DE", "EUR"))
    end)

    t.test("cache: errors are never cached", function()
        local cache = make_cache()
        local ok, err = cache:set_price(3, "DE", "EUR", { appid = 3, status = "error", error = "boom" })
        t.assert_false(ok)
        t.assert_eq(err, "not_cacheable")
        t.assert_nil(cache:get_price(3, "DE", "EUR"))
    end)

    t.test("cache: entries are keyed by appid, country and currency", function()
        local cache = make_cache()
        cache:set_price(4, "DE", "EUR", { appid = 4, status = "matched", product = { price = 1 } })
        t.assert_not_nil(cache:get_price(4, "DE", "EUR"))
        t.assert_nil(cache:get_price(4, "FR", "EUR"))
        t.assert_nil(cache:get_price(4, "DE", "USD"))
    end)

    t.test("cache: writes atomically through a temp file and rename", function()
        local cache, fs = make_cache()
        cache:set_price(5, "DE", "EUR", { appid = 5, status = "matched", product = { price = 1 } })

        local final = "/data/price-cache.json"
        t.assert_not_nil(fs.files[final], "final cache file exists")
        t.assert_nil(fs.files[final .. ".tmp"], "temp file was renamed away")

        local decoded = json.decode(fs.files[final])
        t.assert_not_nil(decoded.entries["5|DE|EUR"])
        t.assert_eq(decoded.entries["5|DE|EUR"].result.status, "matched")
    end)

    t.test("cache: a failed rename leaves no final file and removes the temp file", function()
        local fs = t.mem_fs()
        fs.fail_rename = "disk full"
        local cache = make_cache({ fs = fs })
        local ok, err = cache:set_price(6, "DE", "EUR", {
            appid = 6,
            status = "matched",
            product = { price = 1 },
        })
        t.assert_false(ok)
        t.assert_eq(err, "disk full")
        t.assert_nil(fs.files["/data/price-cache.json"])
        t.assert_nil(fs.files["/data/price-cache.json.tmp"])
    end)

    t.test("cache: a corrupt cache file is discarded, not fatal", function()
        local fs = t.mem_fs()
        fs.files["/data/price-cache.json"] = "{this is not json"
        local cache = make_cache({ fs = fs })

        t.assert_nil(cache:get_price(7, "DE", "EUR"))
        t.assert_eq(cache:count_prices(), 0)

        t.assert_true(cache:set_price(7, "DE", "EUR", {
            appid = 7,
            status = "matched",
            product = { price = 1 },
        }))
        local decoded = json.decode(fs.files["/data/price-cache.json"])
        t.assert_not_nil(decoded.entries["7|DE|EUR"])
    end)

    t.test("cache: clear_prices drops prices but keeps the config cache", function()
        local cache, fs = make_cache()
        cache:set_price(8, "DE", "EUR", { appid = 8, status = "matched", product = { price = 1 } })
        cache:set_config({ appid = "APP", key = "KEY", prefix = "produits_", fetched_at = 1000 })

        t.assert_true(cache:clear_prices())
        t.assert_eq(cache:count_prices(), 0)
        t.assert_nil(fs.files["/data/price-cache.json"])
        t.assert_not_nil(cache:get_config())
    end)

    t.test("cache: config cache expires after 24h", function()
        local cache, _, _, _, advance = make_cache()
        cache:set_config({ appid = "APP", key = "KEY", prefix = "produits_", fetched_at = 1000 })

        t.assert_not_nil(cache:get_config())
        advance(24 * 3600)
        t.assert_not_nil(cache:get_config())

        advance(1)
        t.assert_nil(cache:get_config())
        local config, age = cache:get_config_any()
        t.assert_not_nil(config, "stale config is still available for diagnostics")
        t.assert_eq(age, 24 * 3600 + 1)
    end)

    t.test("cache: empty or missing files are tolerated", function()
        local cache = make_cache()
        t.assert_nil(cache:get_price(9, "DE", "EUR"))
        t.assert_eq(cache:count_prices(), 0)
        local config, age = cache:get_config_any()
        t.assert_nil(config)
        t.assert_nil(age)
    end)
end
