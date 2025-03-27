function lg(...args: unknown[]) {
	for (const arg of args) {
		if (typeof arg === "string") {
			process.stdout.write(arg)
		} else {
			if (arg === null || arg === undefined) {
				process.stdout.write(String(arg))
			} else {
				process.stdout.write(JSON.stringify(arg, Object.getOwnPropertyNames(arg), 2))
			}
		}
		process.stdout.write(" ")
	}
	process.stdout.write("\n")
}

if (process.env.DEBUG === "true") {
	// @ts-ignore: Adding log to globalThis
	globalThis.lg = lg
}