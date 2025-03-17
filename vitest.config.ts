import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		pool: "forks",
		poolOptions: {
			forks: {
				execArgv: ["--stack-trace-limit=30"]
			}
		},
		setupFiles: ["./tests/setup.ts"]
	}
})
