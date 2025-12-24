import { describe, expect, test } from "bun:test"
import { parseConfig } from "../src/config/schema"

describe("Config Schema", () => {
	test("parses empty config with defaults", () => {
		const config = parseConfig({})

		expect(config.dbPath).toBe(".agentfs/")
		expect(config.mountPath).toBe("~/.agentfs/mounts/")
		expect(config.autoMount).toBe(true)
		expect(config.toolTracking.enabled).toBe(true)
		expect(config.toolTracking.trackAll).toBe(true)
	})

	test("parses custom config", () => {
		const config = parseConfig({
			dbPath: "/custom/path/",
			autoMount: false,
			toolTracking: {
				enabled: false,
				trackAll: false,
				excludeTools: ["kv_get"],
			},
		})

		expect(config.dbPath).toBe("/custom/path/")
		expect(config.autoMount).toBe(false)
		expect(config.toolTracking.enabled).toBe(false)
		expect(config.toolTracking.excludeTools).toEqual(["kv_get"])
	})

	test("parses null/undefined as empty config", () => {
		const config1 = parseConfig(null)
		const config2 = parseConfig(undefined)

		expect(config1.autoMount).toBe(true)
		expect(config2.autoMount).toBe(true)
	})
})
