-- Algolia configuration discovery and index naming.
--
-- Instant Gaming publishes the Algolia application id, search key and index
-- prefix in its search page. The key is restricted to the instant-gaming.com
-- origin, which is why requests go through the Lua backend (the native HTTP
-- client can set `Origin`; browser fetches cannot).

local M = {}

M.__index = M

M.DEFAULT_SEARCH_URL = "https://www.instant-gaming.com/en/search/?q=elden%20ring"

M.DEFAULT_INDEX_SUFFIX = "spotlighted_desc"

-- Country -> language of the Instant Gaming storefront. The index is built as
-- `<prefix><lang>_spotlighted_desc`, e.g. `produits_de_spotlighted_desc`.
-- Verified 2026-11-22: en, de, fr, es, it, pt, nl and pl exist; ru and tr
-- return 404, so those countries intentionally fall back to English.
local LANGUAGE_BY_COUNTRY = {
    de = { DE = true, AT = true, CH = true, LU = true, LI = true },
    fr = { FR = true, BE = true, MC = true },
    es = {
        ES = true,
        MX = true,
        AR = true,
        CL = true,
        CO = true,
        PE = true,
        VE = true,
        UY = true,
        EC = true,
        BO = true,
        PY = true,
        CR = true,
        PA = true,
        DO = true,
        GT = true,
        HN = true,
        SV = true,
        NI = true,
        PR = true,
    },
    it = { IT = true, SM = true, VA = true },
    pt = { PT = true, BR = true, AO = true, MZ = true },
    nl = { NL = true },
    pl = { PL = true },
}

--- Language code for a country; defaults to English.
function M.language_for(country)
    local code = tostring(country or ""):upper()
    if code == "" then
        return "en"
    end
    for lang, countries in pairs(LANGUAGE_BY_COUNTRY) do
        if countries[code] then
            return lang
        end
    end
    return "en"
end

--- Build the full Algolia index name from the prefix and a language.
function M.build_index(prefix, lang)
    prefix = tostring(prefix or "produits_")
    if prefix:sub(-1) ~= "_" then
        prefix = prefix .. "_"
    end
    return prefix .. (lang or "en") .. "_" .. M.DEFAULT_INDEX_SUFFIX
end

--- Parse the `window.algoliaConfig` block out of an Instant Gaming page.
--- @return table|nil config `{appid, key, prefix}`
--- @return string|nil error
function M.parse_search_page(html)
    if type(html) ~= "string" or html == "" then
        return nil, "empty_page"
    end

    local function field(name)
        local value = html:match("algolia_" .. name .. "%s*:%s*'([^']+)'")
        if not value then
            value = html:match('algolia_' .. name .. '%s*:%s*"([^"]+)"')
        end
        if value then
            value = value:match("^%s*(.-)%s*$")
        end
        return value
    end

    local appid = field("appid")
    local key = field("key")
    local prefix = field("index")
    if not appid or appid == "" or not key or key == "" or not prefix or prefix == "" then
        return nil, "config_not_found"
    end

    return { appid = appid, key = key, prefix = prefix }
end

--- @param opts table
---   opts.http_client  wrapper exposing :get(url, headers)
---   opts.cache        backend/cache instance
---   opts.clock        unix seconds function
---   opts.logger       logger module
---   opts.search_url   override for tests
function M.new(opts)
    opts = opts or {}
    local self = setmetatable({}, M)
    self.http = opts.http_client or opts.http
    self.cache = opts.cache
    self.clock = opts.clock or os.time
    self.logger = opts.logger
    self.search_url = opts.search_url or M.DEFAULT_SEARCH_URL
    self._last_index = nil
    return self
end

function M:index_for(config, country)
    local index = M.build_index(config.prefix, M.language_for(country))
    self._last_index = index
    return index
end

function M:_fetch()
    if not self.http then
        return nil, "http_unavailable"
    end
    local response, err = self.http:get(self.search_url, {
        ["Accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ["Accept-Language"] = "en-US,en;q=0.9",
        ["Referer"] = "https://www.instant-gaming.com/",
    })
    if not response then
        return nil, err or "http_error"
    end
    local status = tonumber(response.status) or 0
    if status ~= 200 then
        return nil, "http_" .. tostring(status)
    end
    local config, parse_err = M.parse_search_page(response.body)
    if not config then
        return nil, parse_err or "config_not_found"
    end
    config.fetched_at = math.floor(self.clock())
    return config
end

--- Return a fresh Algolia configuration, fetching it when missing/stale.
--- @param country string ISO country code (selects the storefront language)
--- @param force boolean bypass the 24 h config cache
--- @return table|nil config `{appid, key, prefix, fetched_at, index}`
--- @return string|nil error
function M:get(country, force)
    if not force and self.cache then
        local cached = self.cache:get_config()
        if cached and cached.appid and cached.key and cached.prefix then
            local index = self:index_for(cached, country)
            if cached.index ~= index then
                cached.index = index
                self.cache:set_config(cached)
            end
            return cached
        end
    end

    local config, err = self:_fetch()
    if not config then
        if self.logger then
            self.logger:warn("IG Deals: could not read Algolia config: " .. tostring(err))
        end
        return nil, err
    end
    config.index = self:index_for(config, country)
    if self.cache then
        self.cache:set_config(config)
    end
    return config
end

--- Force a refetch, used after an Algolia 403 and by the RPC.
--- @return boolean ok
--- @return string index_or_error
function M:refresh(country)
    local config, err = self:get(country or "US", true)
    if not config then
        return false, err or "refresh_failed"
    end
    return true, config.index
end

--- Index that was last selected, including one restored from the cache.
function M:last_index()
    if self._last_index then
        return self._last_index
    end
    if self.cache and self.cache.get_config_any then
        local cached = self.cache:get_config_any()
        if cached and cached.index then
            self._last_index = cached.index
        end
    end
    return self._last_index
end

return M
