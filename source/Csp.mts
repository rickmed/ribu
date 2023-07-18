import { type Prc } from "./process.mjs"

export class Csp {
	defaultDeadline = 5000
	stackTail: Array<Prc> = []
	stackHead?: Prc = undefined
}