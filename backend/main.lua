-- Millennium backend entry point.
--
-- Wires the real modules together and exposes the RPC functions defined in
-- backend/rpc_functions.lua. Data (cache + overrides) lives in the Millennium
-- config directory under a plugin-specific subdirectory:
--
--   Windows: <steam>/millennium/config/plugins/com.fabioudev.igdeals/
--   Linux/macOS: $HOME/.config/millennium/plugins/com.fabioudev.igdeals/
--
-- Files:
--   price-cache.json     price / negative cache
--   algolia-config.json  discovered Algolia app id, key and index prefix
--   overrides.json       optional appid -> Instant Gaming prod_id map

local logger = require("logger")
local millennium = require("millennium")
local utils = require("utils")
local fs = require("fs")

-- Millennium registers the native cjson library as `json`; some
-- documentation/older builds expose it as `cjson`. Accept either.
local cjson_ok, cjson = pcall(require, "cjson")
if not cjson_ok then
    cjson = require("json")
end

local http_client = require("http_client")
local cache = require("cache")
local config = require("config")
local algolia = require("algolia")
local matching = require("matching")
local api = require("api")
local rpc = require("rpc_functions")

local PLUGIN_DIR = "com.fabioudev.igdeals"

local function join(...)
    if fs and fs.join then
        return fs.join(...)
    end
    return table.concat({ ... }, "/")
end

local function data_dir()
    local os_name = "Linux"
    if type(jit) == "table" and jit.os then
        os_name = jit.os
    end

    local base
    if os_name == "Windows" then
        base = join(millennium.steam_path() or ".", "millennium", "config")
    else
        base = join(utils.getenv("HOME") or ".", ".config", "millennium")
    end
    return join(base, "plugins", PLUGIN_DIR)
end

local function clock()
    return utils.time()
end

local function load_overrides(dir)
    local path = join(dir, "overrides.json")
    local exists_ok, exists = pcall(fs.exists, path)
    if not exists_ok or not exists then
        return {}
    end

    local raw = utils.read_file(path)
    if not raw then
        return {}
    end

    local ok, decoded = pcall(cjson.decode, raw)
    if not ok or type(decoded) ~= "table" then
        logger:warn("IG Deals: overrides.json is corrupt, ignoring it")
        return {}
    end

    local overrides = {}
    for key, value in pairs(decoded) do
        local appid = tonumber(key)
        local prod_id
        if type(value) == "table" then
            prod_id = tonumber(value.prod_id)
        else
            prod_id = tonumber(value)
        end
        if appid and prod_id then
            overrides[tostring(appid)] = prod_id
        end
    end
    return overrides
end

local function make_fs_adapter()
    return {
        read_file = function(path)
            local ok, exists = pcall(fs.exists, path)
            if not ok or not exists then
                return nil, "not_found"
            end
            return utils.read_file(path)
        end,
        write_file = function(path, content)
            return utils.write_file(path, content)
        end,
        make_dirs = function(path)
            return fs.create_directories(path)
        end,
        rename = function(from, to)
            return fs.rename(from, to)
        end,
        remove = function(path)
            return fs.remove(path)
        end,
        exists = function(path)
            local ok, exists = pcall(fs.exists, path)
            return ok and exists or false
        end,
    }
end

local function build_service()
    local dir = data_dir()
    local mkdir_ok, mkdir_err = fs.create_directories(dir)
    if mkdir_ok == nil then
        logger:warn("IG Deals: could not create data directory: " .. tostring(mkdir_err))
    end

    local cache_store = cache.new({
        json = cjson,
        fs = make_fs_adapter(),
        dir = dir,
        clock = clock,
        logger = logger,
    })

    local http = http_client.new({ http = require("http") })
    local config_store = config.new({
        http_client = http,
        cache = cache_store,
        clock = clock,
        logger = logger,
    })
    local algolia_client = algolia.new({
        http_client = http,
        json = cjson,
        logger = logger,
    })
    local matcher = matching.new({
        overrides = load_overrides(dir),
        logger = logger,
    })

    return api.new({
        config = config_store,
        algolia = algolia_client,
        matching = matcher,
        cache = cache_store,
        json = cjson,
        clock = clock,
        sleep = function(milliseconds)
            utils.sleep(milliseconds)
        end,
        logger = logger,
    })
end

local function on_load()
    local ok, service_or_err = pcall(build_service)
    if ok then
        rpc.install(service_or_err)
        logger:info("IG Deals backend loaded (Millennium " .. tostring(millennium.version()) .. ")")
    else
        logger:error("IG Deals backend failed to initialise: " .. tostring(service_or_err))
    end
    millennium.ready()
end

-- Called when the plugin is disabled or Steam shuts down. Not guaranteed on a
-- crash, so no critical work happens here.
local function on_unload()
    logger:info("IG Deals backend unloaded")
end

-- Called once Steam's UI is ready. RPCs are callable from this point on.
local function on_frontend_loaded()
    logger:info("IG Deals: frontend loaded")
end

return {
    on_load = on_load,
    on_unload = on_unload,
    on_frontend_loaded = on_frontend_loaded,
}
