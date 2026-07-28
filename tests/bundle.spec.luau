local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Jest = require(ReplicatedStorage.Jest)
local JestGlobals = Jest.getJestGlobals()

local describe = JestGlobals.describe
local expect = JestGlobals.expect
local it = JestGlobals.it

describe("Jest package bundle", function()
	it("exposes the runner and globals from one package", function()
		expect(type(Jest.runCLI)).toBe("function")
		expect(JestGlobals.expect).toBeDefined()
		expect(JestGlobals.describe).toBeDefined()
		expect(type(JestGlobals.jest.retryTimes)).toBe("function")
	end)

	it("supports package-relative string requires", function()
		local fixture = require(ReplicatedStorage.tests.fixtures.string_package)

		expect(fixture.self).toBe("self")
		expect(fixture.relative).toBe("relative")
		expect(fixture.pesdeRelative).toBe("relative")
	end)
end)
