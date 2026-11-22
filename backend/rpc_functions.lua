-- RPC entry points.
--
-- Millennium exposes global Lua functions in the backend state to the
-- frontend/webview `backend` proxy. The PluginTemplate convention is:
-- `backend/main.lua` does `require("rpc_functions")`, and that module defines
-- plain global functions (the `---@ffi` marker is documentation used by the
-- FFI linter). No return value is needed from the required module.
--
-- Every entry point guards itself with pcall: errors must never cross the RPC
-- boundary. backend/main.lua calls `install(service)` once at startup.

-- Millennium registers the native cjson library as `json`; accept `cjson`
-- too for documentation-compatible/older builds.
local cjson_ok, cjson = pcall(require, "cjson")
if not cjson_ok then
    cjson = require("json")
end

local logger_ok, logger = pcall(require, "logger")
local function log_info(message)
    if logger_ok then
        logger:info(message)
    end
end

local M = {}

local service = nil

function M.install(instance)
    service = instance
end

local function current_time()
    local ok, value = pcall(os.time)
    return ok and value or 0
end

local function error_response(request, message)
    local results = {}
    local games = type(request) == "table" and request.games or nil
    if type(games) == "table" then
        for _, game in ipairs(games) do
            local appid = 0
            if type(game) == "table" then
                appid = tonumber(game.appid) or 0
            end
            results[#results + 1] = {
                appid = appid,
                status = "error",
                error = tostring(message),
            }
        end
    end
    return { results = results, fetched_at = current_time() }
end

---@ffi
--- Resolve Instant Gaming prices for a batch of Steam games.
---@param request table GetPricesRequest
---@return table GetPricesResponse
function get_prices(request)
    if not service then
        log_info("get_prices called before the backend was ready")
        return error_response(request, "backend_not_ready")
    end
    local game_count = (type(request) == "table" and type(request.games) == "table")
        and #request.games
        or 0
    log_info("get_prices called for " .. tostring(game_count) .. " game(s)")
    local ok, response = pcall(service.get_prices, service, request)
    if not ok or type(response) ~= "table" then
        log_info("get_prices failed: " .. tostring(response))
        return error_response(request, "internal_error: " .. tostring(response))
    end
    if type(response.results) == "table" then
        local matched, failed, first_error = 0, 0, nil
        for _, result in ipairs(response.results) do
            if result.status == "matched" then
                matched = matched + 1
            elseif result.status == "error" then
                failed = failed + 1
                first_error = first_error or result.error
            end
        end
        log_info(
            string.format(
                "get_prices: %d result(s), %d matched, %d error(s)%s",
                #response.results,
                matched,
                failed,
                first_error and (" — first: " .. tostring(first_error)) or ""
            )
        )
    end
    return response
end

---@ffi
--- Drop cached prices. The Algolia config cache is kept.
---@return table `{ ok = boolean }`
function clear_cache()
    if not service then
        return { ok = false }
    end
    local ok, response = pcall(service.clear_cache, service)
    if not ok or type(response) ~= "table" then
        return { ok = false }
    end
    return response
end

---@ffi
--- Backend and cache diagnostics.
---@return table BackendStatus
function get_status()
    if not service then
        return {
            algolia_index = cjson.null,
            config_age_seconds = cjson.null,
            cached_games = 0,
            cache_ttl_seconds = 0,
        }
    end
    local ok, response = pcall(service.get_status, service)
    if not ok or type(response) ~= "table" then
        return {
            algolia_index = cjson.null,
            config_age_seconds = cjson.null,
            cached_games = 0,
            cache_ttl_seconds = 0,
        }
    end
    return response
end

---@ffi
--- Re-read the Algolia config from the Instant Gaming search page.
---@return table `{ ok, index?, error? }`
function refresh_config()
    if not service then
        return { ok = false, error = "backend_not_ready" }
    end
    local ok, response = pcall(service.refresh_config, service)
    if not ok or type(response) ~= "table" then
        return { ok = false, error = tostring(response) }
    end
    return response
end

return M
