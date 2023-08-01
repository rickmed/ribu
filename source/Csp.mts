import { type Prc } from "./process.mjs"

export class Csp {

	prcStack: Array<Prc> = []

	get runningPrc() {
		return this.prcStack.at(-1)
	}
}