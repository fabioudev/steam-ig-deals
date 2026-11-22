-- Steam title -> Instant Gaming product matching.
--
-- Instant Gaming hits carry no Steam app id, so matching is title based. The
-- module is intentionally conservative: editions, platform tags and region
-- restrictions are checked explicitly, and anything below the confidence
-- threshold becomes `no_match` instead of a wrong product.
--
-- Manual overrides live in `<plugin data dir>/overrides.json` as either
--   { "1245620": 4824 }
-- or
--   { "1245620": { "prod_id": 4824 } }
-- The path is resolved in backend/main.lua (plugin data dir, see main.lua).

local M = {}

M.__index = M

M.MIN_SCORE = 0.82

local STOPWORDS = {
    ["the"] = true,
    ["a"] = true,
    ["an"] = true,
    ["of"] = true,
    ["and"] = true,
    ["edition"] = true,
}

local PLATFORM_WORDS = {
    ["pc"] = true,
    ["steam"] = true,
    ["windows"] = true,
    ["win"] = true,
    ["mac"] = true,
    ["macos"] = true,
    ["linux"] = true,
}

local TRAILING_TAGS = {
    ["pc"] = true,
    ["steam"] = true,
    ["windows"] = true,
    ["win"] = true,
    ["mac"] = true,
    ["macos"] = true,
    ["linux"] = true,
    ["global"] = true,
    ["worldwide"] = true,
    ["key"] = true,
    ["cd"] = true,
    ["download"] = true,
}

local TRAILING_PHRASES = {
    "steam edition",
    "pc edition",
    "windows edition",
    "steam key",
    "pc key",
    "global key",
}

-- Lowercase UTF-8 sequences -> ASCII. Applied before punctuation stripping.
local DIACRITICS = {
    { "á", "a" },
    { "à", "a" },
    { "â", "a" },
    { "ä", "a" },
    { "ã", "a" },
    { "å", "a" },
    { "ā", "a" },
    { "ă", "a" },
    { "ą", "a" },
    { "é", "e" },
    { "è", "e" },
    { "ê", "e" },
    { "ë", "e" },
    { "ē", "e" },
    { "ĕ", "e" },
    { "ė", "e" },
    { "ę", "e" },
    { "ě", "e" },
    { "í", "i" },
    { "ì", "i" },
    { "î", "i" },
    { "ï", "i" },
    { "ī", "i" },
    { "ĭ", "i" },
    { "į", "i" },
    { "ó", "o" },
    { "ò", "o" },
    { "ô", "o" },
    { "ö", "o" },
    { "õ", "o" },
    { "ø", "o" },
    { "ō", "o" },
    { "ŏ", "o" },
    { "ő", "o" },
    { "ú", "u" },
    { "ù", "u" },
    { "û", "u" },
    { "ü", "u" },
    { "ū", "u" },
    { "ŭ", "u" },
    { "ů", "u" },
    { "ű", "u" },
    { "ç", "c" },
    { "ć", "c" },
    { "č", "c" },
    { "ñ", "n" },
    { "ń", "n" },
    { "š", "s" },
    { "ś", "s" },
    { "ž", "z" },
    { "ź", "z" },
    { "ż", "z" },
    { "ý", "y" },
    { "ÿ", "y" },
    { "ř", "r" },
    { "ł", "l" },
    { "ď", "d" },
    { "đ", "d" },
    { "ť", "t" },
    { "ğ", "g" },
    { "ß", "ss" },
    { "æ", "ae" },
    { "œ", "oe" },
    { "þ", "th" },
    { "ð", "d" },
}

-- Edition phrases (longest first) and their canonical labels.
local EDITION_ALIASES = {
    { "game of the year edition", "goty" },
    { "digital deluxe edition", "deluxe" },
    { "collectors edition", "collectors" },
    { "collector s edition", "collectors" },
    { "anniversary edition", "anniversary" },
    { "definitive edition", "definitive" },
    { "legendary edition", "legendary" },
    { "complete edition", "complete" },
    { "enhanced edition", "enhanced" },
    { "ultimate edition", "ultimate" },
    { "premium edition", "premium" },
    { "special edition", "special" },
    { "standard edition", "standard" },
    { "deluxe edition", "deluxe" },
    { "launch edition", "launch" },
    { "day one edition", "dayone" },
    { "goty edition", "goty" },
    { "gold edition", "gold" },
    { "directors cut", "directors" },
}
table.sort(EDITION_ALIASES, function(left, right)
    return #left[1] > #right[1]
end)

local COUNTRY_REGIONS = {}
local function add_region(region, codes)
    for code in codes:gmatch("%a+") do
        local key = code:upper()
        COUNTRY_REGIONS[key] = COUNTRY_REGIONS[key] or {}
        COUNTRY_REGIONS[key][region] = true
    end
end

add_region(
    "europe",
    "AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE GB UK IS NO CH LI AL BA ME MK RS XK MD UA TR RU"
)
add_region("north_america", "US CA")
add_region("latin_america", "MX BR AR CL CO PE VE UY EC BO PY CR PA DO GT HN SV NI PR CU")
add_region("south_america", "AR BO BR CL CO EC GY PY PE SR UY VE")
add_region("asia", "AF AM AZ BD BT BN KH CN GE HK IN ID JP KZ KG LA MO MY MV MN MM NP PK PH SG KR LK TW TJ TH TL TM UZ VN")
add_region("oceania", "AU NZ FJ PG SB VU WS TO")
add_region("middle_east", "AE SA IL TR QA KW BH OM JO LB IQ IR YE PS")
add_region(
    "africa",
    "DZ AO BJ BW BF BI CM CV CF TD KM CG CD CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU MA MZ NA NE NG RW ST SN SC SL SO ZA SS SD TZ TG TN UG ZM ZW"
)

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
    -- JSON null arrives as cjson's lightuserdata (or the test shim's table).
    if type(value) == "userdata" or type(value) == "table" then
        return false
    end
    return true
end

local function tokenize(text)
    local tokens = {}
    for word in tostring(text or ""):gmatch("%S+") do
        tokens[#tokens + 1] = word
    end
    return tokens
end

local function has_platform_word(text)
    local padded = " " .. tostring(text or ""):lower():gsub("[^%w]+", " ") .. " "
    for word in pairs(PLATFORM_WORDS) do
        if padded:find(" " .. word .. " ", 1, true) then
            return true
        end
    end
    return false
end

local function strip_platform_noise(text)
    local stripped = text:gsub("%b()", function(inner)
        if has_platform_word(inner) then
            return " "
        end
        return " " .. inner .. " "
    end)

    local lowered = stripped:lower()
    for _, phrase in ipairs(TRAILING_PHRASES) do
        if #lowered >= #phrase and lowered:sub(-#phrase) == phrase then
            local base = lowered:sub(1, #lowered - #phrase)
            if base == "" or base:sub(-1) == " " then
                lowered = base:gsub("%s+$", "")
            end
        end
    end

    local words = tokenize(lowered)
    while #words > 0 and TRAILING_TAGS[words[#words]] do
        table.remove(words)
    end
    return table.concat(words, " ")
end

--- Normalize a title for comparison.
--- Lowercase, strip trademarks/diacritics/punctuation, platform tags and
--- collapse whitespace. Edition suffixes are kept here; use split_title to
--- separate them for scoring.
function M.normalize_title(name)
    local text = tostring(name or ""):lower()
    text = text:gsub("™", ""):gsub("®", ""):gsub("©", "")
    text = text:gsub("&", " and ")
    for _, mapping in ipairs(DIACRITICS) do
        text = text:gsub(mapping[1], mapping[2])
    end
    text = strip_platform_noise(text)
    text = text:gsub("[%p]", " ")
    text = text:gsub("[^%w%s]", " ")
    text = text:gsub("%s+", " "):gsub("^%s+", ""):gsub("%s+$", "")
    return text
end

local function strip_suffix(title, phrase)
    if #title < #phrase or title:sub(-#phrase) ~= phrase then
        return nil, false
    end
    local base = title:sub(1, #title - #phrase)
    if base ~= "" and base:sub(-1) ~= " " then
        return nil, false
    end
    return (base:gsub("%s+$", "")), true
end

--- Split a normalized title into (base, edition_label).
--- `edition_label` is nil for base games, a canonical alias for known
--- editions, or `"other:<words>"` for unrecognized trailing "… Edition".
local function split_title_impl(name)
    local title = M.normalize_title(name)
    for _, alias in ipairs(EDITION_ALIASES) do
        local base, found = strip_suffix(title, alias[1])
        if found then
            return base, alias[2]
        end
    end
    local base, found = strip_suffix(title, "edition")
    if found then
        local words = tokenize(base)
        local start = math.max(1, #words - 3)
        return base, "other:" .. table.concat(words, " ", start)
    end
    return title, nil
end

M.split_title = split_title_impl

--- Instance alias for the public normalization helper.
function M:normalize(name)
    return M.normalize_title(name)
end

local function sorted_tokens(tokens)
    local copy = {}
    for index, value in ipairs(tokens) do
        copy[index] = value
    end
    table.sort(copy)
    return copy
end

local function same_tokens(left, right)
    if #left ~= #right then
        return false
    end
    local a, b = sorted_tokens(left), sorted_tokens(right)
    for index = 1, #a do
        if a[index] ~= b[index] then
            return false
        end
    end
    return true
end

local function contains_span(haystack, needle)
    if #needle == 0 or #needle > #haystack then
        return nil
    end
    for start = 1, #haystack - #needle + 1 do
        local matched = true
        for offset = 1, #needle do
            if haystack[start + offset - 1] ~= needle[offset] then
                matched = false
                break
            end
        end
        if matched then
            return start
        end
    end
    return nil
end

local function extra_significant(haystack, needle, start, count)
    local extras = 0
    for index = 1, #haystack do
        if index < start or index >= start + count then
            if not STOPWORDS[haystack[index]] then
                extras = extras + 1
            end
        end
    end
    return extras
end

local function overlap_count(left, right)
    local counts = {}
    for _, word in ipairs(left) do
        counts[word] = (counts[word] or 0) + 1
    end
    local overlap = 0
    for _, word in ipairs(right) do
        if (counts[word] or 0) > 0 then
            overlap = overlap + 1
            counts[word] = counts[word] - 1
        end
    end
    return overlap
end

local function region_flags(region)
    local padded = " " .. tostring(region or ""):lower():gsub("[^%w]+", " ") .. " "
    local flags = {}
    if padded:find(" worldwide ", 1, true) or padded:find(" global ", 1, true) or padded:find(" all regions ", 1, true) then
        flags.worldwide = true
    end
    if padded:find(" europe ", 1, true) then
        flags.europe = true
    end
    if padded:find(" north america ", 1, true) then
        flags.north_america = true
    end
    if padded:find(" latin america ", 1, true) then
        flags.latin_america = true
    end
    if padded:find(" south america ", 1, true) then
        flags.south_america = true
    end
    if padded:find(" asia ", 1, true) then
        flags.asia = true
    end
    if padded:find(" oceania ", 1, true) or padded:find(" australia ", 1, true) then
        flags.oceania = true
    end
    if padded:find(" middle east ", 1, true) then
        flags.middle_east = true
    end
    if padded:find(" africa ", 1, true) then
        flags.africa = true
    end
    if padded:find(" us ", 1, true) or padded:find(" usa ", 1, true) or padded:find(" canada ", 1, true) then
        flags.north_america = true
    end
    return flags
end

--- Country whitelist/blacklist and region string compatibility.
function M.region_compatible(hit, country)
    local code = tostring(country or ""):upper()
    if code == "" then
        return true
    end

    local whitelist = hit.country_whitelist
    if type(whitelist) == "table" and next(whitelist) ~= nil then
        local allowed = false
        for _, entry in ipairs(whitelist) do
            local candidate = tostring(entry):upper()
            if candidate == code or candidate == "WW" or candidate == "WORLDWIDE" or candidate == "GLOBAL" then
                allowed = true
                break
            end
        end
        if not allowed then
            return false
        end
    end

    local blacklist = hit.country_blacklist
    if type(blacklist) == "table" then
        for _, entry in ipairs(blacklist) do
            if tostring(entry):upper() == code then
                return false
            end
        end
    end

    local region = tostring(hit.region or "")
    if region == "" then
        return true
    end

    local flags = region_flags(region)
    if flags.worldwide then
        return true
    end
    local has_known_region = false
    for _ in pairs(flags) do
        has_known_region = true
        break
    end
    if not has_known_region then
        return region:lower() == code:lower()
    end

    local allowed_regions = COUNTRY_REGIONS[code]
    if not allowed_regions then
        return false
    end
    for region_name in pairs(flags) do
        if allowed_regions[region_name] then
            return true
        end
    end
    return false
end

--- Reject non-Steam, drafts and region-incompatible hits.
--- @return boolean eligible
--- @return string|nil reason
function M:eligible(hit, country)
    if type(hit) ~= "table" then
        return false, "invalid_hit"
    end
    -- Check the platform field directly: normalize_title treats a bare
    -- "Steam" as a trailing platform tag and would reduce it to "".
    local platform = tostring(hit.platform or hit.type or ""):lower()
    if platform:find("steam", 1, true) == nil then
        return false, "platform"
    end
    if truthy(hit.is_draft) then
        return false, "draft"
    end
    if not M.region_compatible(hit, country) then
        return false, "region"
    end
    return true
end

--- Confidence score in [0, 1]; 0 means "do not match".
function M:score(steam_name, hit, country)
    if not self:eligible(hit, country) then
        return 0
    end

    local steam_full = M.normalize_title(steam_name)
    local ig_full = M.normalize_title(hit.name or hit.fullname or "")
    if steam_full == "" or ig_full == "" then
        return 0
    end

    local steam_base, steam_edition = M.split_title(steam_full)
    local ig_base, ig_edition = M.split_title(ig_full)
    local steam_tokens, ig_tokens = tokenize(steam_base), tokenize(ig_base)
    if #steam_tokens == 0 or #ig_tokens == 0 then
        return 0
    end

    local penalty = 0
    local steam_neutral = steam_edition == nil or steam_edition == "standard"
    local ig_neutral = ig_edition == nil or ig_edition == "standard"
    if not steam_neutral and not ig_neutral then
        if steam_edition ~= ig_edition then
            return 0
        end
    elseif not steam_neutral then
        -- Steam asks for an edition the IG hit does not represent.
        penalty = penalty + 0.30
    elseif not ig_neutral then
        -- IG only offers an edition of the base game: do not silently price it.
        penalty = penalty + 0.20
    end

    local score = 0
    if steam_base == ig_base then
        score = 1.0
    elseif same_tokens(steam_tokens, ig_tokens) then
        score = 0.99
    else
        local ig_start = contains_span(ig_tokens, steam_tokens)
        local steam_start = contains_span(steam_tokens, ig_tokens)
        if ig_start then
            score = 0.80 + 0.15 * (#steam_tokens / #ig_tokens)
            penalty = penalty + 0.12 * extra_significant(ig_tokens, steam_tokens, ig_start, #steam_tokens)
        elseif steam_start then
            score = 0.78 + 0.15 * (#ig_tokens / #steam_tokens)
            penalty = penalty + 0.10 * extra_significant(steam_tokens, ig_tokens, steam_start, #ig_tokens)
        else
            local overlap = overlap_count(steam_tokens, ig_tokens)
            local shortest = math.min(#steam_tokens, #ig_tokens)
            local union = #steam_tokens + #ig_tokens - overlap
            local coverage = shortest > 0 and (overlap / shortest) or 0
            if overlap < 2 or coverage < 0.75 then
                return 0
            end
            score = 0.55 + 0.30 * (overlap / union) + 0.15 * coverage
        end
    end

    score = score - penalty
    if score < self.min_score then
        return 0
    end
    return math.min(score, 1.0)
end

local function stock_rank(hit)
    return truthy(hit.has_stock) and 1 or 0
end

local function preorder_rank(hit)
    return truthy(hit.preorder) and 1 or 0
end

local function dlc_rank(hit)
    return truthy(hit.is_dlc) and 1 or 0
end

--- Select the best matching hit for a Steam game.
--- @return table|nil hit
--- @return string reason
function M:select(game, hits, country)
    if type(game) ~= "table" or type(hits) ~= "table" then
        return nil, "invalid_input"
    end

    local override = self.overrides and self.overrides[tostring(game.appid)]
    if override ~= nil then
        local wanted = tostring(override)
        for _, hit in ipairs(hits) do
            if tostring(hit.prod_id or hit.objectID) == wanted then
                local eligible, reason = self:eligible(hit, country)
                if eligible then
                    return hit, "override"
                end
                return nil, "override_" .. tostring(reason)
            end
        end
        -- The override product was not part of this result page; fall through
        -- to normal matching rather than failing the whole game.
    end

    local best, best_score, best_stock, best_preorder, best_dlc, best_updated
    for _, hit in ipairs(hits) do
        local score = self:score(game.name or "", hit, country)
        if score > 0 then
            local stock = stock_rank(hit)
            local preorder = preorder_rank(hit)
            local dlc = dlc_rank(hit)
            local updated = tonumber(hit.updated_at) or 0

            local better = false
            if not best then
                better = true
            elseif score > best_score + 1e-9 then
                better = true
            elseif math.abs(score - best_score) <= 1e-9 then
                if stock ~= best_stock then
                    better = stock > best_stock
                elseif preorder ~= best_preorder then
                    better = preorder < best_preorder
                elseif dlc ~= best_dlc then
                    better = dlc < best_dlc
                elseif updated ~= best_updated then
                    better = updated > best_updated
                end
            end

            if better then
                best, best_score, best_stock, best_preorder, best_dlc, best_updated =
                    hit, score, stock, preorder, dlc, updated
            end
        end
    end

    if not best then
        return nil, "no_candidate"
    end
    return best, string.format("score:%.3f", best_score)
end

--- @param opts table
---   opts.overrides  appid -> prod_id map
---   opts.min_score  confidence threshold (default 0.82)
function M.new(opts)
    opts = opts or {}
    local self = setmetatable({}, M)
    self.overrides = opts.overrides or {}
    self.min_score = opts.min_score or M.MIN_SCORE
    self.logger = opts.logger
    return self
end

return M
