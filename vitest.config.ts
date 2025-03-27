import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		pool: "forks",
		poolOptions: {
			forks: {
				execArgv: ["--stack-trace-limit=30"]
			}
		},
		setupFiles: ["./test/setup.ts"]
	},
	resolve: {
		alias: [
			{
				// resolve .js imports to .ts files
				find: /^(.+)\.js$/,
				replacement: "$1.ts"
			}
		]
	}
})
