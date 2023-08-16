import { type Prc } from "./process.js"

export class Csp {
	deadLn = 5000

	prcStack: Array<Prc> = []

	get runningPrc() {
		return this.prcStack.at(-1)
	}
}