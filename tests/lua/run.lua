-- Dependency-free Lua test runner.
--
-- Usage (from anywhere):
--   luajit tests/lua/run.lua
--
-- Network and real filesystem access are never used: every backend module is
-- instantiated with injected fakes.

local script = (arg and arg[0]) or "tests/lua/run.lua"
local lua_dir = script:match("^(.*)[/\\][^/\\]+$") or "tests/lua"
local root = lua_dir .. "/../.."

package.path = table.concat({
    root .. "/?.lua",
    root .. "/backend/?.lua",
    root .. "/tests/lua/?.lua",
    root .. "/tests/lua/support/?.lua",
    package.path,
}, ";")

-- backend/rpc_functions.lua and backend/main.lua use cjson in production.
package.preload["cjson"] = function()
    return require("json")
end

local harness = require("harness")
harness.root = root

local specs = {
    "specs.config_spec",
    "specs.matching_spec",
    "specs.cache_spec",
    "specs.algolia_spec",
    "specs.http_spec",
    "specs.api_spec",
    "specs.rpc_spec",
}

for _, name in ipairs(specs) do
    local ok, spec = pcall(require, name)
    if not ok then
        print("FAIL load " .. name .. ": " .. tostring(spec))
        os.exit(1)
    end
    spec(harness)
end

local failures = harness.run()
os.exit(failures == 0 and 0 or 1)
