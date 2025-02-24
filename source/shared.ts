export const EMPTY = Symbol("Empty")

export type Observer = {
	onObservableDone: (val: unknown) => void
}