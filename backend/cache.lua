-- Persistent JSON cache with TTL and atomic writes.
--
-- Files live under the plugin data directory (see backend/main.lua):
--   <data>/price-cache.json     keyed by appid|country|currency
--   <data>/algolia-config.json  Algolia app id / key / index prefix
--
-- All filesystem access is injected so the module stays dependency-free and
-- testable. Corrupt files are discarded with a warning instead of failing the
-- plugin. Writes go to a temp file and are renamed into place, so a crash can
-- never leave a half-written cache behind.

local M = {}

M.__index = M

M.PRICE_TTL = 12 * 60 * 60
M.NEGATIVE_TTL = 24 * 60 * 60
M.CONFIG_TTL = 24 * 60 * 60

local function parent_dir(path)
    return path:match("^(.*)[/\\][^/\\]+$") or "."
end

function M.price_key(appid, country, currency)
    return tostring(appid) .. "|" .. tostring(country):upper() .. "|" .. tostring(currency):upper()
end

--- @param opts table
---   opts.json        cjson-compatible module (encode/decode/null)
---   opts.fs          adapter with read_file/write_file/make_dirs/rename/remove
---   opts.dir         data directory
---   opts.clock       unix seconds function
---   opts.price_ttl   seconds (default 12 h)
---   opts.negative_ttl seconds (default 24 h)
---   opts.config_ttl  seconds (default 24 h)
---   opts.logger      logger module
function M.new(opts)
    opts = opts or {}
    assert(opts.json, "cache: json module is required")
    assert(opts.fs, "cache: fs adapter is required")

    local self = setmetatable({}, M)
    self.json = opts.json
    self.fs = opts.fs
    self.dir = opts.dir or "."
    self.clock = opts.clock or os.time
    self.logger = opts.logger
    self.price_ttl_seconds = opts.price_ttl or M.PRICE_TTL
    self.negative_ttl_seconds = opts.negative_ttl or M.NEGATIVE_TTL
    self.config_ttl_seconds = opts.config_ttl or M.CONFIG_TTL
    self.price_path = opts.price_path or (self.dir .. "/price-cache.json")
    self.config_path = opts.config_path or (self.dir .. "/algolia-config.json")
    self.prices = nil
    self.config = nil
    self.config_loaded = false
    return self
end

function M:_warn(message)
    if self.logger then
        self.logger:warn(message)
    end
end

function M:_atomic_write(path, content)
    local dir = parent_dir(path)
    if self.fs.make_dirs then
        local ok, err = self.fs.make_dirs(dir)
        if ok == nil and err then
            return false, err
        end
    end

    local tmp = path .. ".tmp"
    local wrote, write_err = self.fs.write_file(tmp, content)
    if not wrote then
        return false, write_err or "write_failed"
    end

    local renamed, rename_err = self.fs.rename(tmp, path)
    if not renamed then
        if self.fs.remove then
            self.fs.remove(tmp)
        end
        return false, rename_err or "rename_failed"
    end
    return true
end

function M:_load_prices()
    if self.prices then
        return self.prices
    end
    self.prices = {}

    local raw = self.fs.read_file(self.price_path)
    if not raw or raw == "" then
        return self.prices
    end

    local ok, data = pcall(self.json.decode, raw)
    if not ok or type(data) ~= "table" or type(data.entries) ~= "table" then
        self:_warn("IG Deals: price cache is corrupt, discarding it")
        return self.prices
    end
    self.prices = data.entries
    return self.prices
end

function M:_save_prices()
    local ok, encoded = pcall(self.json.encode, { version = 1, entries = self.prices })
    if not ok then
        self:_warn("IG Deals: could not encode price cache: " .. tostring(encoded))
        return false, encoded
    end
    return self:_atomic_write(self.price_path, encoded)
end

function M:_load_config()
    if self.config_loaded then
        return self.config
    end
    self.config_loaded = true

    local raw = self.fs.read_file(self.config_path)
    if not raw or raw == "" then
        return nil
    end

    local ok, data = pcall(self.json.decode, raw)
    if not ok or type(data) ~= "table" then
        self:_warn("IG Deals: config cache is corrupt, discarding it")
        self.config = nil
        return nil
    end
    self.config = data
    return self.config
end

function M:_save_config()
    local ok, encoded = pcall(self.json.encode, self.config)
    if not ok then
        self:_warn("IG Deals: could not encode config cache: " .. tostring(encoded))
        return false, encoded
    end
    return self:_atomic_write(self.config_path, encoded)
end

function M:_ttl_for(status)
    if status == "no_match" then
        return self.negative_ttl_seconds
    end
    if status == "matched" or status == "unavailable" then
        return self.price_ttl_seconds
    end
    return nil
end

--- Fresh cached result for one game, or nil.
function M:get_price(appid, country, currency)
    local entries = self:_load_prices()
    local entry = entries[M.price_key(appid, country, currency)]
    if type(entry) ~= "table" or type(entry.result) ~= "table" then
        return nil
    end

    local ttl = self:_ttl_for(entry.result.status)
    if not ttl then
        return nil
    end

    local age = self.clock() - (tonumber(entry.fetched_at) or 0)
    if age > ttl then
        return nil
    end

    return entry.result
end

--- Cache a result. Errors are never cached; no_match uses the negative TTL.
function M:set_price(appid, country, currency, result)
    if type(result) ~= "table" then
        return false, "invalid_result"
    end
    if not self:_ttl_for(result.status) then
        return false, "not_cacheable"
    end

    local entries = self:_load_prices()
    entries[M.price_key(appid, country, currency)] = {
        result = result,
        fetched_at = self.clock(),
    }
    return self:_save_prices()
end

--- Number of cached price entries, including expired ones.
function M:count_prices()
    local count = 0
    for _ in pairs(self:_load_prices()) do
        count = count + 1
    end
    return count
end

function M:price_ttl()
    return self.price_ttl_seconds
end

--- Remove the price cache, keeping the Algolia config cache.
function M:clear_prices()
    self.prices = {}
    if self.fs.exists and self.fs.exists(self.price_path) and self.fs.remove then
        local ok, err = self.fs.remove(self.price_path)
        if not ok then
            local saved, save_err = self:_save_prices()
            if not saved then
                return false, save_err or err
            end
        end
        return true
    end
    return self:_save_prices()
end

--- Fresh config or nil.
function M:get_config()
    local config = self:_load_config()
    if type(config) ~= "table" then
        return nil
    end
    local fetched_at = tonumber(config.fetched_at)
    if not fetched_at then
        return nil
    end
    if self.clock() - fetched_at > self.config_ttl_seconds then
        return nil
    end
    return config
end

--- Cached config even when stale (for diagnostics).
--- @return table|nil config
--- @return number|nil age_seconds
function M:get_config_any()
    local config = self:_load_config()
    if type(config) ~= "table" then
        return nil, nil
    end
    local fetched_at = tonumber(config.fetched_at)
    if not fetched_at then
        return config, nil
    end
    local age = self.clock() - fetched_at
    if age < 0 then
        age = 0
    end
    return config, math.floor(age)
end

function M:set_config(config)
    if type(config) ~= "table" then
        return false, "invalid_config"
    end
    self.config = config
    self.config_loaded = true
    return self:_save_config()
end

function M:config_age_seconds()
    local _, age = self:get_config_any()
    return age
end

return M
