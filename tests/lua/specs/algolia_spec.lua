return function(t)
    local algoliamod = require("algolia")
    local json = require("json")

    local fixture_text = t.read_file(t.root .. "/tests/fixtures/algolia-elden-ring.json")
    local fixture = json.decode(fixture_text)
    local hit = fixture.hits[1]

    local function copy(source)
        local out = {}
        for key, value in pairs(source) do
            out[key] = value
        end
        return out
    end

    local function make_client(responder)
        local captured = { requests = {} }
        local http = {
            post = function(self, url, body, headers)
                captured.requests[#captured.requests + 1] = {
                    url = url,
                    body = body,
                    headers = headers,
                }
                if type(responder) == "function" then
                    return responder(url, body, headers)
                end
                return responder
            end,
        }
        local client = algoliamod.new({ http_client = http, json = json, logger = t.fake_logger() })
        return client, captured
    end

    local credentials = {
        appid = "TESTAPPID",
        key = "test-only-search-key",
        index = "produits_en_spotlighted_desc",
    }

    t.test("algolia: URL-encodes query terms", function()
        t.assert_eq(algoliamod.url_encode("elden ring"), "elden%20ring")
        t.assert_eq(algoliamod.url_encode("a&b=c"), "a%26b%3Dc")
        t.assert_eq(algoliamod.url_encode("pokémon"), "pok%C3%A9mon")
    end)

    t.test("algolia: posts the documented body, headers and index URL", function()
        local client, captured = make_client({ status = 200, body = fixture_text })
        local hits, err = client:query("elden ring", credentials)
        t.assert_nil(err)
        t.assert_eq(#hits, 2)
        t.assert_eq(hits[1].prod_id, 4824)

        local request = captured.requests[1]
        t.assert_eq(
            request.url,
            "https://testappid-dsn.algolia.net/1/indexes/produits_en_spotlighted_desc/query"
        )
        t.assert_eq(request.headers["Origin"], "https://www.instant-gaming.com")
        t.assert_eq(request.headers["x-algolia-application-id"], "TESTAPPID")
        t.assert_eq(request.headers["x-algolia-api-key"], "test-only-search-key")
        t.assert_eq(request.headers["content-type"], "application/json")

        local body = json.decode(request.body)
        t.assert_eq(body.params, "query=elden%20ring&hitsPerPage=20")
    end)

    t.test("algolia: maps HTTP statuses to recovery-friendly errors", function()
        local client = make_client({ status = 403, body = "Method not allowed with this referer" })
        local hits, err, status = client:query("x", credentials)
        t.assert_nil(hits)
        t.assert_eq(err, "forbidden")
        t.assert_eq(status, 403)

        client = make_client({ status = 404, body = "index not found" })
        hits, err, status = client:query("x", credentials)
        t.assert_nil(hits)
        t.assert_eq(err, "index_not_found")
        t.assert_eq(status, 404)

        client = make_client({ status = 500, body = "oops" })
        hits, err = client:query("x", credentials)
        t.assert_nil(hits)
        t.assert_eq(err, "http_500")
    end)

    t.test("algolia: transport and decoding failures are reported, not thrown", function()
        local client = make_client(function()
            return nil, "network down"
        end)
        local hits, err = client:query("x", credentials)
        t.assert_nil(hits)
        t.assert_eq(err, "network down")

        client = make_client({ status = 200, body = "not json" })
        hits, err = client:query("x", credentials)
        t.assert_nil(hits)
        t.assert_eq(err, "invalid_response")

        client = make_client({ status = 200, body = '{"hits":null}' })
        hits, err = client:query("x", credentials)
        t.assert_nil(hits)
        t.assert_eq(err, "invalid_response")
    end)

    t.test("algolia: requires credentials", function()
        local client = make_client({ status = 200, body = fixture_text })
        local hits, err = client:query("x", { index = "produits_en_spotlighted_desc" })
        t.assert_nil(hits)
        t.assert_eq(err, "missing_credentials")
    end)

    t.test("algolia: normalizes a EUR hit into the shared IgProduct shape", function()
        local client = make_client({ status = 200, body = fixture_text })
        local product, err = client:normalize(hit, "EUR")
        t.assert_nil(err)
        t.assert_eq(product.prod_id, 4824)
        t.assert_eq(product.object_id, "4824")
        t.assert_eq(product.name, "Elden Ring")
        t.assert_eq(product.full_name, "Elden Ring - PC (Steam)")
        t.assert_eq(product.platform, "Steam")
        t.assert_eq(product.region, "Europe")
        t.assert_almost_eq(product.price, 45.99)
        t.assert_almost_eq(product.retail, 59.99)
        t.assert_eq(product.discount, 23)
        t.assert_eq(product.currency, "EUR")
        t.assert_true(product.has_stock)
        t.assert_false(product.preorder)
        t.assert_false(product.is_dlc)
        t.assert_eq(
            product.url,
            "https://www.instant-gaming.com/en/4824-buy-elden-ring-pc-steam/"
        )
    end)

    t.test("algolia: selects price, retail and discount from currency_prices", function()
        local client = make_client({ status = 200, body = fixture_text })

        local usd = client:normalize(hit, "USD")
        t.assert_almost_eq(usd.price, 45.99)
        t.assert_almost_eq(usd.retail, 59.99)
        t.assert_eq(usd.discount, 16)
        t.assert_eq(usd.currency, "USD")

        local gbp = client:normalize(hit, "GBP")
        t.assert_almost_eq(gbp.price, 45.99)
        t.assert_almost_eq(gbp.retail, 49.99)
        t.assert_eq(gbp.discount, 23)
    end)

    t.test("algolia: missing currency price makes the product unavailable", function()
        local client = make_client({ status = 200, body = fixture_text })
        local product, err = client:normalize(hit, "JPY")
        t.assert_nil(product)
        t.assert_eq(err, "no_price")
    end)

    t.test("algolia: out-of-stock and preorder flags survive normalization", function()
        local client = make_client({ status = 200, body = fixture_text })

        local no_stock = copy(hit)
        no_stock.has_stock = 0
        local product = client:normalize(no_stock, "EUR")
        t.assert_false(product.has_stock)

        local preorder = copy(hit)
        preorder.preorder = 1
        product = client:normalize(preorder, "EUR")
        t.assert_true(product.preorder)
    end)

    t.test("algolia: unknown retail becomes JSON null", function()
        local client = make_client({ status = 200, body = fixture_text })
        local no_retail = copy(hit)
        no_retail.retail = nil
        no_retail.retail_prices = {}
        local product = client:normalize(no_retail, "EUR")
        t.assert_true(product.retail == json.null)
    end)

    t.test("algolia: computes a discount when the discounts map has no entry", function()
        local client = make_client({ status = 200, body = fixture_text })
        local custom = copy(hit)
        custom.discounts = {}
        custom.currency_prices = { EUR = 45.0 }
        custom.retail_prices = { EUR = "60.00" }
        local product = client:normalize(custom, "EUR")
        t.assert_eq(product.discount, 25)
    end)

    t.test("algolia: coerces numeric strings and falls back to the EUR price field", function()
        local client = make_client({ status = 200, body = fixture_text })

        local string_price = copy(hit)
        string_price.currency_prices = { USD = "45.99" }
        string_price.retail_prices = {}
        local product = client:normalize(string_price, "USD")
        t.assert_almost_eq(product.price, 45.99)

        local eur_only = copy(hit)
        eur_only.currency_prices = {}
        eur_only.price = 42.5
        product = client:normalize(eur_only, "EUR")
        t.assert_almost_eq(product.price, 42.5)
    end)

    t.test("algolia: URL falls back when seo_name is missing", function()
        local client = make_client({ status = 200, body = fixture_text })
        local no_seo = copy(hit)
        no_seo.seo_name = nil
        local product = client:normalize(no_seo, "EUR")
        t.assert_eq(product.url, "https://www.instant-gaming.com/en/4824/")
    end)

    t.test("algolia: rejects hits without a product id", function()
        local client = make_client({ status = 200, body = fixture_text })
        local broken = copy(hit)
        broken.prod_id = nil
        broken.objectID = nil
        local product, err = client:normalize(broken, "EUR")
        t.assert_nil(product)
        t.assert_eq(err, "missing_prod_id")
    end)
end
