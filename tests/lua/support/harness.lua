-- Tiny zero-dependency test harness: PASS/FAIL lines and a summary.

local M = {}

local tests = {}

function M.test(name, fn)
    tests[#tests + 1] = { name = name, fn = fn }
end

function M.assert_true(value, message)
    if not value then
        error(message or "expected a truthy value", 2)
    end
end

function M.assert_false(value, message)
    if value then
        error(message or "expected a falsy value", 2)
    end
end

function M.assert_eq(actual, expected, message)
    if actual ~= expected then
        error(
            string.format(
                "%s: expected %s, got %s",
                message or "assert_eq",
                tostring(expected),
                tostring(actual)
            ),
            2
        )
    end
end

function M.assert_nil(value, message)
    if value ~= nil then
        error((message or "expected nil") .. ", got " .. tostring(value), 2)
    end
end

function M.assert_not_nil(value, message)
    if value == nil then
        error(message or "expected a non-nil value", 2)
    end
end

function M.assert_almost_eq(actual, expected, tolerance, message)
    tolerance = tolerance or 1e-6
    if type(actual) ~= "number" or math.abs(actual - expected) > tolerance then
        error(
            string.format(
                "%s: expected %s (±%s), got %s",
                message or "assert_almost_eq",
                tostring(expected),
                tostring(tolerance),
                tostring(actual)
            ),
            2
        )
    end
end

function M.assert_contains(haystack, needle, message)
    if type(haystack) ~= "string" or not haystack:find(needle, 1, true) then
        error(
            string.format(
                "%s: %q does not contain %q",
                message or "assert_contains",
                tostring(haystack),
                tostring(needle)
            ),
            2
        )
    end
end

function M.assert_match(value, pattern, message)
    if type(value) ~= "string" or not value:match(pattern) then
        error(
            string.format(
                "%s: %q does not match %q",
                message or "assert_match",
                tostring(value),
                tostring(pattern)
            ),
            2
        )
    end
end

function M.read_file(path)
    local file, err = io.open(path, "rb")
    if not file then
        error("cannot read " .. tostring(path) .. ": " .. tostring(err), 2)
    end
    local content = file:read("*a")
    file:close()
    return content
end

--- In-memory filesystem used instead of touching the real disk.
function M.mem_fs()
    local fs = { files = {}, dirs = {} }

    function fs.read_file(path)
        return fs.files[path]
    end

    function fs.write_file(path, content)
        fs.files[path] = content
        return true
    end

    function fs.make_dirs(path)
        fs.dirs[path] = true
        return true
    end

    function fs.rename(from, to)
        if fs.fail_rename then
            return nil, fs.fail_rename
        end
        if not fs.files[from] then
            return nil, "missing temp file"
        end
        fs.files[to] = fs.files[from]
        fs.files[from] = nil
        return true
    end

    function fs.remove(path)
        if fs.files[path] then
            fs.files[path] = nil
            return true
        end
        return false
    end

    function fs.exists(path)
        return fs.files[path] ~= nil or fs.dirs[path] ~= nil
    end

    return fs
end

function M.fake_logger()
    local logger = { messages = {} }

    local function record(level)
        return function(self, message)
            self.messages[#self.messages + 1] = { level = level, message = message }
        end
    end

    logger.info = record("info")
    logger.warn = record("warn")
    logger.error = record("error")
    return logger
end

--- Controllable clock. Returns read, set, advance.
function M.clock(start)
    local now = start or 1000
    local function read()
        return now
    end
    local function set(value)
        now = value
    end
    local function advance(seconds)
        now = now + seconds
    end
    return read, set, advance
end

function M.run()
    local passed = 0
    local failed = 0

    for _, test in ipairs(tests) do
        local ok, err = pcall(test.fn)
        if ok then
            passed = passed + 1
            print("PASS " .. test.name)
        else
            failed = failed + 1
            print("FAIL " .. test.name .. ": " .. tostring(err))
        end
    end

    print(string.format("\n%d passed, %d failed, %d total", passed, failed, #tests))
    return failed
end

return M
