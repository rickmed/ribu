/* eslint-disable */
function lg(obj: unknown, maxDepth: number = Infinity) {
	if (typeof obj === "string") {
		console.log(obj)
		return
	}

	const seen = new WeakSet()

	function serialize(value: any, currentDepth: number, indent: string): string {
		if (value === null) return "null"
		if (typeof value !== "object") return JSON.stringify(value)

		if (seen.has(value)) return "[Circular]"
		if (currentDepth >= maxDepth) return "..."

		seen.add(value)
		const nextIndent = indent + "  "

		if (Array.isArray(value)) {
			if (value.length === 0) return "[]"
			const items = value.map(item =>
				nextIndent + serialize(item, currentDepth + 1, nextIndent)
			)
			return "[\n" + items.join(",\n") + "\n" + indent + "]"
		}

		const entries = Object.entries(value)
		if (entries.length === 0) return "{}"
		const lines = entries.map(([key, val]) => {
			const serialized = serialize(val, currentDepth + 1, nextIndent)
			return `${nextIndent}${JSON.stringify(key)}: ${serialized}`
		})
		return "{\n" + lines.join(",\n") + "\n" + indent + "}"
	}

	console.log(serialize(obj, 0, ""))
}

if (process.env.DEBUG === "true") {
	// @ts-ignore
	globalThis.lg = lg
}
