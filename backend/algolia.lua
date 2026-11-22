-- Algolia search client and response normalization.
--
-- Instant Gaming's search is Algolia. The search key is origin-restricted, so
-- every request carries `Origin: https://www.instant-gaming.com` (browser
-- fetches from Steam's origin get 403 "Method not allowed with this referer").
--
-- The response is normalized into the `IgProduct` shape from shared/types.ts.

local M = {}

M.__index = M

M.ENDPOINT = "https://%s-dsn.algolia.net/1/indexes/%s/query"
M.ORIGIN = "https://www.instant-gaming.com"
M.PRODUCT_URL = "https://www.instant-gaming.com/en/%s-buy-%s/"
M.HITS_PER_PAGE = 20

--- Percent-encode a query component (RFC 3986 unreserved characters kept).
function M.url_encode(value)
    return (tostring(value or ""):gsub("([^%w%-%._~])", function(char)
        return string.format("%%%02X", string.byte(char))
    end))
end

local function truthy(value)
    if value == nil or value == false then
        return false
    end
    if type(value) == "number" then
        return value ~= 0
    end
    if type(value) == "string" then
        local lowered = value:lower()
        return value ~= "" and value ~= "0" and lowered ~= "false"
    end
    if type(value) == "userdata" or type(value) == "table" then
        return false
    end
    return true
end

local function numeric(value)
    if type(value) == "number" then
        return value
    end
    if type(value) == "string" then
        return tonumber(value)
    end
    return nil
end

--- @param opts table
---   opts.http_client  wrapper exposing :post(url, body, headers)
---   opts.json         cjson-compatible module
---   opts.logger       logger module
function M.new(opts)
    opts = opts or {}
    local self = setmetatable({}, M)
    self.http = opts.http_client or opts.http
    self.json = opts.json
    self.logger = opts.logger
    self.hits_per_page = opts.hits_per_page or M.HITS_PER_PAGE
    return self
end

--- POST one query to the Algolia index and return the raw hits.
--- @return table|nil hits
--- @return string|nil error `forbidden`, `index_not_found`, `http_<status>`, ...
--- @return number|nil http_status
function M:query(term, opts)
    opts = opts or {}
    if not opts.appid or not opts.key or not opts.index then
        return nil, "missing_credentials"
    end
    if not self.http then
        return nil, "http_unavailable"
    end

    local params = "query="
        .. M.url_encode(term)
        .. "&hitsPerPage="
        .. tostring(self.hits_per_page)
    local ok, body = pcall(self.json.encode, { params = params })
    if not ok then
        return nil, "encode_failed"
    end

    -- The host is derived from the runtime-discovered app id, e.g.
    -- ABC123DEF4 -> abc123def4-dsn.algolia.net.
    local url = string.format(
        M.ENDPOINT,
        tostring(opts.appid):lower(),
        tostring(opts.index)
    )
    local headers = {
        ["x-algolia-application-id"] = tostring(opts.appid),
        ["x-algolia-api-key"] = tostring(opts.key),
        ["content-type"] = "application/json",
        ["Origin"] = M.ORIGIN,
        ["Referer"] = M.ORIGIN .. "/",
        ["Accept"] = "application/json",
    }

    local response, err = self.http:post(url, body, headers)
    if not response then
        return nil, err or "http_error"
    end

    local status = tonumber(response.status) or 0
    if status == 403 then
        return nil, "forbidden", status
    end
    if status == 404 then
        return nil, "index_not_found", status
    end
    if status ~= 200 then
        return nil, "http_" .. tostring(status), status
    end

    local decoded, data = pcall(self.json.decode, response.body or "")
    if
        not decoded
        or type(data) ~= "table"
        or type(data.hits) ~= "table"
        or (self.json.null ~= nil and data.hits == self.json.null)
    then
        return nil, "invalid_response", status
    end
    return data.hits
end

--- Turn one Algolia hit into an `IgProduct` for the requested currency.
--- @return table|nil product
--- @return string|nil error `no_price`, `missing_prod_id`, ...
function M:normalize(hit, currency)
    if type(hit) ~= "table" then
        return nil, "invalid_hit"
    end

    local code = tostring(currency or ""):upper()
    local prod_id = numeric(hit.prod_id) or numeric(hit.objectID)
    if not prod_id or prod_id <= 0 then
        return nil, "missing_prod_id"
    end

    local prices = type(hit.currency_prices) == "table" and hit.currency_prices or {}
    local price = numeric(prices[code])
    if price == nil and code == "EUR" then
        price = numeric(hit.price)
    end
    if price == nil then
        return nil, "no_price"
    end

    local retail_prices = type(hit.retail_prices) == "table" and hit.retail_prices or {}
    local retail = numeric(retail_prices[code])
    if retail == nil and code == "EUR" then
        retail = numeric(hit.retail)
    end
    local null = self.json and self.json.null or nil
    if retail == nil and null ~= nil then
        retail = null
    end

    local discounts = type(hit.discounts) == "table" and hit.discounts or {}
    local discount = numeric(discounts[code])
    if discount == nil then
        if type(retail) == "number" and retail > 0 then
            discount = math.floor(((retail - price) / retail) * 100 + 0.5)
        else
            discount = 0
        end
    end
    if discount < 0 then
        discount = 0
    end

    local name = hit.name or hit.small_name or hit.fullname or ""
    local full_name = hit.fullname or name
    local seo_name = hit.seo_name and tostring(hit.seo_name) or ""
    local url
    if seo_name ~= "" then
        url = string.format(M.PRODUCT_URL, tostring(prod_id), seo_name)
    else
        url = "https://www.instant-gaming.com/en/" .. tostring(prod_id) .. "/"
    end

    return {
        prod_id = prod_id,
        object_id = tostring(hit.objectID or prod_id),
        name = tostring(name),
        full_name = tostring(full_name),
        platform = tostring(hit.platform or hit.type or ""),
        region = tostring(hit.region or ""),
        price = price,
        retail = retail,
        discount = discount,
        currency = code,
        url = url,
        has_stock = truthy(hit.has_stock),
        preorder = truthy(hit.preorder),
        is_dlc = truthy(hit.is_dlc),
    }
end

return M
