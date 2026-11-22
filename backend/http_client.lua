-- HTTP wrapper for the Instant Gaming requests.
--
-- This module is deliberately called `http_client` and NOT `http`: in a
-- packed `.star`, Millennium registers every backend Lua file in
-- `package.preload` under a name derived from its path relative to the
-- backend directory. A file named `backend/http.lua` would therefore be
-- registered as `http` and shadow the native libcurl-backed module, making
-- the real `require("http")` unreachable. Keeping the wrapper at
-- `backend/http_client.lua` avoids that collision (the native module stays
-- available as `require("http")`).
--
-- The native module is injected for tests; production wiring lives in
-- backend/main.lua.

local M = {}

M.__index = M

M.USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    .. "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

local function merge(base, extra)
    local out = {}
    for key, value in pairs(base or {}) do
        out[key] = value
    end
    for key, value in pairs(extra or {}) do
        out[key] = value
    end
    return out
end

--- @param opts table|nil
---   opts.http          native `require("http")` module (injected in tests)
---   opts.user_agent    override for the browser-like User-Agent
---   opts.timeout       request timeout in seconds (default 20)
---   opts.headers       headers sent with every request
function M.new(opts)
    opts = opts or {}
    local self = setmetatable({}, M)
    self.http = opts.http or require("http")
    self.user_agent = opts.user_agent or M.USER_AGENT
    self.timeout = opts.timeout or 20
    self.headers = opts.headers or {
        ["Accept-Language"] = "en-US,en;q=0.9",
    }
    return self
end

--- Perform a request through the native module.
--- @return table|nil response `{status, body, headers}`
--- @return string|nil error
function M:request(url, opts)
    opts = opts or {}
    local request = {
        method = opts.method or "GET",
        data = opts.data,
        headers = merge(self.headers, opts.headers),
        timeout = opts.timeout or self.timeout,
        user_agent = opts.user_agent or self.user_agent,
        follow_redirects = true,
        verify_ssl = true,
    }

    local ok, response, err = pcall(self.http.request, url, request)
    if not ok then
        return nil, tostring(response)
    end
    if not response then
        return nil, err or "http_request_failed"
    end
    return response
end

--- GET request with extra headers.
function M:get(url, headers)
    return self:request(url, { method = "GET", headers = headers })
end

--- POST a body with extra headers.
function M:post(url, body, headers)
    return self:request(url, { method = "POST", data = body, headers = headers })
end

return M
