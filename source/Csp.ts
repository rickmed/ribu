import { type Prc } from "./process.js"

export class Csp {

	prcStack: Array<Prc> = []

	get runningPrc() {
		return this.prcStack.at(-1)
	}
}