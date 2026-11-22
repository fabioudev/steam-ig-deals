return function(t)
    local httpclient = require("http_client")

    t.test("http wrapper: forwards method, body, headers, user agent and timeout", function()
        local captured
        local native = {
            request = function(url, options)
                captured = { url = url, options = options }
                return { status = 200, body = "ok", headers = {} }
            end,
        }
        local client = httpclient.new({ http = native, user_agent = "TestAgent/1.0", timeout = 7 })

        local response = client:get("https://example.test/a", {
            Origin = "https://www.instant-gaming.com",
        })
        t.assert_eq(response.status, 200)
        t.assert_eq(captured.url, "https://example.test/a")
        t.assert_eq(captured.options.method, "GET")
        t.assert_eq(captured.options.headers.Origin, "https://www.instant-gaming.com")
        t.assert_eq(captured.options.headers["Accept-Language"], "en-US,en;q=0.9")
        t.assert_eq(captured.options.user_agent, "TestAgent/1.0")
        t.assert_eq(captured.options.timeout, 7)
        t.assert_true(captured.options.follow_redirects)
        t.assert_true(captured.options.verify_ssl)

        client:post("https://example.test/b", '{"a":1}', {
            ["content-type"] = "application/json",
        })
        t.assert_eq(captured.options.method, "POST")
        t.assert_eq(captured.options.data, '{"a":1}')
        t.assert_eq(captured.options.headers["content-type"], "application/json")
    end)

    t.test("http wrapper: transport failures and exceptions become nil, error", function()
        local client = httpclient.new({
            http = {
                request = function()
                    return nil, "offline"
                end,
            },
        })
        local response, err = client:get("https://example.test")
        t.assert_nil(response)
        t.assert_eq(err, "offline")

        client = httpclient.new({
            http = {
                request = function()
                    error("kaboom")
                end,
            },
        })
        response, err = client:get("https://example.test")
        t.assert_nil(response)
        t.assert_contains(err, "kaboom")
    end)
end
