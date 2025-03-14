/* eslint-disable */
// @ts-nocheck

const agents = process.env.npm_config_user_agent
	.split(" ")
	.filter((agent) => agent.startsWith("bun"))

if (agents.length === 0) {
	console.error("❌ Unable to parse Bun version from user agent string.")
	process.exit(1)
}

const bunAgent = agents[0].split("/")[1].split(".").map(Number)

if (bunAgent.length !== 3) {
	console.error("❌ Unable to parse Bun version from user agent string.")
	process.exit(1)
}

const [major, minor, patch] = bunAgent

// Bun 1.2.x is required
if (major !== 1 || minor !== 2) {
	console.error(`❌ Incompatible Bun version detected: ${major}.${minor}.${patch}. Expected version: 1.2.x.`)
	process.exit(1)
}
