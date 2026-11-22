-- Minimal dependency-free JSON codec used by the Lua tests.
--
-- The production backend uses Millennium's native cjson. This shim implements
-- the subset the backend touches (objects, arrays, strings, numbers, booleans
-- and null) so the tests can run with plain Lua 5.1 / LuaJIT.
--
-- JSON null decodes to `M.null`, mirroring `cjson.null`. Empty Lua tables
-- encode as `{}` (also matching cjson's default).

local M = {}

M._VERSION = "test-json 1.0"

M.null = setmetatable({}, {
    __tostring = function()
        return "null"
    end,
})

local function utf8_char(codepoint)
    if codepoint < 0x80 then
        return string.char(codepoint)
    end
    if codepoint < 0x800 then
        return string.char(
            0xC0 + math.floor(codepoint / 0x40),
            0x80 + codepoint % 0x40
        )
    end
    if codepoint < 0x10000 then
        return string.char(
            0xE0 + math.floor(codepoint / 0x1000),
            0x80 + math.floor(codepoint / 0x40) % 0x40,
            0x80 + codepoint % 0x40
        )
    end
    return string.char(
        0xF0 + math.floor(codepoint / 0x40000),
        0x80 + math.floor(codepoint / 0x1000) % 0x40,
        0x80 + math.floor(codepoint / 0x40) % 0x40,
        0x80 + codepoint % 0x40
    )
end

local function skip_whitespace(text, index)
    while true do
        local char = text:sub(index, index)
        if char == " " or char == "\n" or char == "\r" or char == "\t" then
            index = index + 1
        else
            return index
        end
    end
end

local parse_value

local function parse_string(text, index)
    index = index + 1
    local out = {}
    while index <= #text do
        local char = text:sub(index, index)
        if char == '"' then
            return table.concat(out), index + 1
        end
        if char == "\\" then
            local code = text:sub(index + 1, index + 1)
            if code == '"' or code == "\\" or code == "/" then
                out[#out + 1] = code
                index = index + 2
            elseif code == "b" then
                out[#out + 1] = "\b"
                index = index + 2
            elseif code == "f" then
                out[#out + 1] = "\f"
                index = index + 2
            elseif code == "n" then
                out[#out + 1] = "\n"
                index = index + 2
            elseif code == "r" then
                out[#out + 1] = "\r"
                index = index + 2
            elseif code == "t" then
                out[#out + 1] = "\t"
                index = index + 2
            elseif code == "u" then
                local hex = text:sub(index + 2, index + 5)
                if #hex < 4 or not hex:match("^%x%x%x%x$") then
                    return nil, index, "invalid unicode escape"
                end
                local codepoint = tonumber(hex, 16)
                index = index + 6
                if
                    codepoint >= 0xD800
                    and codepoint <= 0xDBFF
                    and text:sub(index, index + 1) == "\\u"
                then
                    local low_hex = text:sub(index + 2, index + 5)
                    local low = low_hex:match("^%x%x%x%x$") and tonumber(low_hex, 16)
                    if low and low >= 0xDC00 and low <= 0xDFFF then
                        codepoint = 0x10000 + (codepoint - 0xD800) * 0x400 + (low - 0xDC00)
                        index = index + 6
                    end
                end
                out[#out + 1] = utf8_char(codepoint)
            else
                return nil, index, "invalid escape"
            end
        else
            out[#out + 1] = char
            index = index + 1
        end
    end
    return nil, index, "unterminated string"
end

local function is_digit(char)
    return char ~= "" and char:match("%d") ~= nil
end

local function parse_number(text, index)
    local start = index
    if text:sub(index, index) == "-" then
        index = index + 1
    end

    local char = text:sub(index, index)
    if char == "0" then
        index = index + 1
    elseif is_digit(char) then
        while is_digit(text:sub(index, index)) do
            index = index + 1
        end
    else
        return nil, index, "invalid number"
    end

    if text:sub(index, index) == "." then
        index = index + 1
        if not is_digit(text:sub(index, index)) then
            return nil, index, "invalid fraction"
        end
        while is_digit(text:sub(index, index)) do
            index = index + 1
        end
    end

    local exponent = text:sub(index, index)
    if exponent == "e" or exponent == "E" then
        index = index + 1
        local sign = text:sub(index, index)
        if sign == "+" or sign == "-" then
            index = index + 1
        end
        if not is_digit(text:sub(index, index)) then
            return nil, index, "invalid exponent"
        end
        while is_digit(text:sub(index, index)) do
            index = index + 1
        end
    end

    return tonumber(text:sub(start, index - 1)), index
end

local function parse_array(text, index, depth)
    local array = {}
    index = skip_whitespace(text, index + 1)
    if text:sub(index, index) == "]" then
        return array, index + 1
    end

    while true do
        local value, next_index, err = parse_value(text, index, depth + 1)
        if err then
            return nil, next_index, err
        end
        array[#array + 1] = value
        index = skip_whitespace(text, next_index)
        local char = text:sub(index, index)
        if char == "]" then
            return array, index + 1
        end
        if char ~= "," then
            return nil, index, "expected ',' or ']'"
        end
        index = skip_whitespace(text, index + 1)
    end
end

local function parse_object(text, index, depth)
    local object = {}
    index = skip_whitespace(text, index + 1)
    if text:sub(index, index) == "}" then
        return object, index + 1
    end

    while true do
        index = skip_whitespace(text, index)
        if text:sub(index, index) ~= '"' then
            return nil, index, "expected object key"
        end
        local key, next_index, key_err = parse_string(text, index)
        if key_err then
            return nil, next_index, key_err
        end
        index = skip_whitespace(text, next_index)
        if text:sub(index, index) ~= ":" then
            return nil, index, "expected ':'"
        end
        index = skip_whitespace(text, index + 1)
        local value, value_index, value_err = parse_value(text, index, depth + 1)
        if value_err then
            return nil, value_index, value_err
        end
        object[key] = value
        index = skip_whitespace(text, value_index)
        local char = text:sub(index, index)
        if char == "}" then
            return object, index + 1
        end
        if char ~= "," then
            return nil, index, "expected ',' or '}'"
        end
        index = skip_whitespace(text, index + 1)
    end
end

parse_value = function(text, index, depth)
    if depth > 100 then
        return nil, index, "nesting too deep"
    end
    index = skip_whitespace(text, index)
    local char = text:sub(index, index)
    if char == "" then
        return nil, index, "unexpected end of input"
    end
    if char == '"' then
        return parse_string(text, index)
    end
    if char == "{" then
        return parse_object(text, index, depth)
    end
    if char == "[" then
        return parse_array(text, index, depth)
    end
    if char == "-" or is_digit(char) then
        return parse_number(text, index)
    end
    if text:sub(index, index + 3) == "true" then
        return true, index + 4
    end
    if text:sub(index, index + 4) == "false" then
        return false, index + 5
    end
    if text:sub(index, index + 3) == "null" then
        return M.null, index + 4
    end
    return nil, index, "unexpected character"
end

function M.decode(text)
    if type(text) ~= "string" then
        return nil, "input must be a string"
    end
    local index = skip_whitespace(text, 1)
    local value, next_index, err = parse_value(text, index, 0)
    if err then
        return nil, err
    end
    next_index = skip_whitespace(text, next_index)
    if next_index <= #text then
        return nil, "trailing data"
    end
    return value
end

local function escape_string(value)
    local out = { '"' }
    for index = 1, #value do
        local byte = value:byte(index)
        local char = value:sub(index, index)
        if char == '"' then
            out[#out + 1] = '\\"'
        elseif char == "\\" then
            out[#out + 1] = "\\\\"
        elseif byte == 8 then
            out[#out + 1] = "\\b"
        elseif byte == 9 then
            out[#out + 1] = "\\t"
        elseif byte == 10 then
            out[#out + 1] = "\\n"
        elseif byte == 12 then
            out[#out + 1] = "\\f"
        elseif byte == 13 then
            out[#out + 1] = "\\r"
        elseif byte < 32 then
            out[#out + 1] = string.format("\\u%04x", byte)
        else
            out[#out + 1] = char
        end
    end
    out[#out + 1] = '"'
    return table.concat(out)
end

local function is_array(value)
    local count = 0
    local max_index = 0
    for key in pairs(value) do
        if type(key) ~= "number" or key < 1 or key % 1 ~= 0 then
            return false
        end
        count = count + 1
        if key > max_index then
            max_index = key
        end
    end
    return count > 0 and max_index == count
end

local encode_value

encode_value = function(value)
    if value == nil or value == M.null then
        return "null"
    end

    local value_type = type(value)
    if value_type == "boolean" then
        return value and "true" or "false"
    end
    if value_type == "number" then
        if value ~= value or value == math.huge or value == -math.huge then
            return "null"
        end
        return string.format("%.14g", value)
    end
    if value_type == "string" then
        return escape_string(value)
    end
    if value_type == "table" then
        if is_array(value) then
            local parts = {}
            for index = 1, #value do
                parts[index] = encode_value(value[index])
            end
            return "[" .. table.concat(parts, ",") .. "]"
        end

        local keys = {}
        for key in pairs(value) do
            keys[#keys + 1] = tostring(key)
        end
        table.sort(keys)
        local parts = {}
        for _, key in ipairs(keys) do
            parts[#parts + 1] = escape_string(key) .. ":" .. encode_value(value[key])
        end
        return "{" .. table.concat(parts, ",") .. "}"
    end

    return "null"
end

function M.encode(value)
    return encode_value(value)
end

return M
