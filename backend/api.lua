-- Core RPC service: cache-aware price resolution with per-game isolation.
--
-- Every game is resolved independently. No error escapes `get_prices`: a
-- failed lookup becomes `{status = "error", error = "..."}` for that appid
-- while the rest of the batch still resolves.

local M = {}

M.__index = M

M.MAX_BATCH = 100
M.QUERY_DELAY_MS = 250

local function error_result(appid, message)
    return { appid = appid, status = "error", error = tostring(message) }
end

local function valid_country(value)
    return type(value) == "string" and value:match("^%a%a$") ~= nil
end

local function valid_currency(value)
    return type(value) == "string" and value:match("^%a%a%a$") ~= nil
end

--- @param opts table
---   opts.config    backend/config instance
---   opts.algolia   backend/algolia instance
---   opts.matching  backend/matching instance
---   opts.cache     backend/cache instance
---   opts.json      cjson-compatible module (for explicit JSON nulls)
---   opts.clock     unix seconds function
---   opts.sleep     milliseconds sleep function
---   opts.logger    logger module
function M.new(opts)
    opts = opts or {}
    local self = setmetatable({}, M)
    self.config = opts.config
    self.algolia = opts.algolia
    self.matching = opts.matching
    self.cache = opts.cache
    self.json = opts.json
    self.clock = opts.clock or os.time
    self.sleep = opts.sleep or function() end
    self.logger = opts.logger
    self.max_batch = opts.max_batch or M.MAX_BATCH
    self.query_delay_ms = opts.query_delay_ms or M.QUERY_DELAY_MS
    self.default_country = opts.default_country or "US"
    self._last_country = nil
    return self
end

function M:_config_error(ctx, appid)
    return error_result(appid, ctx.config_error or "config_unavailable")
end

--- Query Algolia, recovering from a rotated key (403) and from a
--- language-specific index that does not exist (404 -> English index).
function M:_query_with_recovery(term, country, ctx)
    local config = ctx.config
    if not config then
        return nil, "config_unavailable"
    end

    local index = self.config:index_for(config, country)
    local hits, err, status = self.algolia:query(term, {
        appid = config.appid,
        key = config.key,
        index = index,
    })
    if hits then
        return hits
    end

    if err == "forbidden" then
        -- The search key can rotate; refetch the config and retry once.
        self.sleep(self.query_delay_ms)
        local refreshed, refresh_result = self.config:refresh(country)
        if refreshed then
            local new_config = self.config:get(country)
            if new_config then
                ctx.config = new_config
                index = self.config:index_for(new_config, country)
                hits, err, status = self.algolia:query(term, {
                    appid = new_config.appid,
                    key = new_config.key,
                    index = index,
                })
                if hits then
                    return hits
                end
            else
                err = refresh_result or err
            end
        else
            err = refresh_result or err
        end
    elseif err == "index_not_found" and self.config.language_for(country) ~= "en" then
        -- Localized storefront index missing; fall back to the English one.
        self.sleep(self.query_delay_ms)
        local english_index = self.config.build_index(config.prefix, "en")
        hits, err, status = self.algolia:query(term, {
            appid = config.appid,
            key = config.key,
            index = english_index,
        })
        if hits then
            return hits
        end
    end

    return nil, err or "query_failed", status
end

function M:_resolve(game, country, currency, force, ctx)
    local appid = tonumber(game.appid) or 0
    if appid <= 0 or type(game.name) ~= "string" or game.name == "" then
        return error_result(appid, "invalid_game")
    end

    if not force then
        local cached = self.cache:get_price(appid, country, currency)
        if cached then
            return cached
        end
    end

    if ctx.config_error or not ctx.config then
        return self:_config_error(ctx, appid)
    end

    local hits, err = self:_query_with_recovery(game.name, country, ctx)
    -- Keep requests sequential; ~250 ms between Algolia calls.
    self.sleep(self.query_delay_ms)
    if not hits then
        return error_result(appid, tostring(err or "query_failed"))
    end

    local hit, reason = self.matching:select(game, hits, country)
    if not hit then
        local result = { appid = appid, status = "no_match" }
        self.cache:set_price(appid, country, currency, result)
        return result
    end

    local product, normalize_err = self.algolia:normalize(hit, currency)
    if not product then
        if normalize_err ~= "no_price" and self.logger then
            self.logger:warn(
                "IG Deals: could not normalize product for appid "
                    .. tostring(appid)
                    .. ": "
                    .. tostring(normalize_err)
            )
        end
        local result = { appid = appid, status = "unavailable" }
        self.cache:set_price(appid, country, currency, result)
        return result
    end

    local status = "matched"
    if not product.preorder and not product.has_stock then
        status = "unavailable"
    end

    local result = { appid = appid, status = status, product = product }
    self.cache:set_price(appid, country, currency, result)
    return result
end

--- @param request GetPricesRequest
--- @return GetPricesResponse
function M:get_prices(request)
    local results = {}
    if type(request) ~= "table" then
        return { results = results, fetched_at = math.floor(self.clock()) }
    end

    local games = request.games
    if type(games) ~= "table" then
        return { results = results, fetched_at = math.floor(self.clock()) }
    end

    local country = type(request.country) == "string" and request.country:upper() or nil
    local currency = type(request.currency) == "string" and request.currency:upper() or nil
    local force = request.force == true

    local invalid
    if not valid_country(country) then
        invalid = "invalid_country"
    elseif not valid_currency(currency) then
        invalid = "invalid_currency"
    end

    local ctx = {}
    if not invalid then
        self._last_country = country
        local ok, config, config_err = pcall(self.config.get, self.config, country)
        if ok and type(config) == "table" then
            ctx.config = config
        else
            ctx.config_error = "config_unavailable"
            if self.logger then
                self.logger:warn(
                    "IG Deals: Algolia config unavailable: "
                        .. tostring(config_err or config)
                )
            end
        end
    end

    local processed = {}
    local unique_count = 0

    for _, game in ipairs(games) do
        local appid = tonumber(type(game) == "table" and game.appid) or 0
        local key = tostring(appid)
        local result

        if invalid then
            result = error_result(appid, invalid)
        elseif type(game) ~= "table" then
            result = error_result(appid, "invalid_game")
        elseif processed[key] then
            result = processed[key]
        elseif unique_count >= self.max_batch then
            result = error_result(appid, "batch_limit_exceeded")
        else
            unique_count = unique_count + 1
            local ok, resolved = pcall(self._resolve, self, game, country, currency, force, ctx)
            if ok and type(resolved) == "table" then
                result = resolved
            else
                result = error_result(appid, "internal_error: " .. tostring(resolved))
                if self.logger then
                    self.logger:error("IG Deals: resolve failed for appid " .. key .. ": " .. tostring(resolved))
                end
            end
            processed[key] = result
        end

        results[#results + 1] = result
    end

    return { results = results, fetched_at = math.floor(self.clock()) }
end

--- @return { ok: boolean }
function M:clear_cache()
    local ok, err = pcall(self.cache.clear_prices, self.cache)
    if not ok then
        if self.logger then
            self.logger:error("IG Deals: clear_cache failed: " .. tostring(err))
        end
        return { ok = false }
    end
    return { ok = err ~= false }
end

--- @return BackendStatus
function M:get_status()
    local null = self.json and self.json.null or nil

    local config_ok, _, age = pcall(self.cache.get_config_any, self.cache)
    if not config_ok then
        age = nil
    end

    local index_ok, index = pcall(self.config.last_index, self.config)
    if not index_ok then
        index = nil
    end

    local count_ok, count = pcall(self.cache.count_prices, self.cache)
    if not count_ok or type(count) ~= "number" then
        count = 0
    end

    local ttl = 0
    if self.cache.price_ttl then
        local ttl_ok, value = pcall(self.cache.price_ttl, self.cache)
        if ttl_ok and type(value) == "number" then
            ttl = value
        end
    end

    return {
        algolia_index = index or null,
        config_age_seconds = age ~= nil and age or null,
        cached_games = count,
        cache_ttl_seconds = ttl,
    }
end

--- @return { ok: boolean, index?: string, error?: string }
function M:refresh_config()
    local country = self._last_country or self.default_country
    local call_ok, refreshed, index = pcall(self.config.refresh, self.config, country)
    if not call_ok then
        return { ok = false, error = tostring(refreshed) }
    end
    if not refreshed then
        return { ok = false, error = tostring(index or "refresh_failed") }
    end
    return { ok = true, index = index }
end

return M
