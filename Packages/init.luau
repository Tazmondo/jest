local Jest = require(script.Jest)

local bundle = table.clone(Jest)

local function getJestGlobals(): typeof(require(script.JestGlobals))
	return getfenv(2).require(script.JestGlobals)
end

(bundle :: any).getJestGlobals = getJestGlobals

return bundle :: typeof(bundle) & {
	getJestGlobals: typeof(getJestGlobals),
}
