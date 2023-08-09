const RibuE = Symbol("RibuExc")

type Ebase<N extends string = string> = {
	readonly [RibuE]: true
	readonly name: N
}

export type E<N extends string = string> = Ebase<N> & {
	readonly error: Error
}
export function E<N extends string>(name: N, error: Error): E<N> {
	return { name, error, [RibuE]: true }
}

type RibuStack = Array<{
	prcName: string,
	prcArgs: unknown[]
}>
type Eother = E<"Other"> & {
	ribuStack: RibuStack
}
export function EOther(error: Error, ribuStack: RibuStack): Eother {
	return { name: "Other", error, ribuStack, [RibuE]: true }
}

export type Ecancelled = Ebase<"Cancelled">
export function Ecancelled(): Ecancelled {
	return { name: "Cancelled", [RibuE]: true }
}

export function e(x: unknown): x is Ebase {
	return isRibuE(x)
}

export function notName<X, T extends Extract<X, E>["name"]>(x: X, name: T): x is Extract<X, E> & Exclude<X, E<T>> {
	return isRibuE(x) && x.name !== name
}


function isRibuE(x: unknown): x is E {
	return typeof x === "object" && x !== null && RibuE in x && "name" in x
}
