const RibuE = Symbol("RibuExc")

type EBase<Tag extends string = string> = {
	readonly [RibuE]: true
	readonly tag: Tag
}

export type E<Tag extends string = string> = EBase<Tag> & {
	readonly cause: Error
}
export function E<Tag extends string>(tag: Tag, cause: Error): E<Tag> {
	return { tag, cause, [RibuE]: true }
}

export function EUnknown(cause: Error) {
	return E("Unknown", cause)
}

export type EPrcCancelled = EBase<"ProcessCancelled">
export function EPrcCancelled(): EPrcCancelled {
	return { tag: "ProcessCancelled", [RibuE]: true }
}

export function e(x: unknown): x is EBase {
	return isRibuE(x)
}

export function notTag<X, T extends Extract<X, E>["tag"]>(x: X, tag: T): x is Extract<X, E> & Exclude<X, E<T>> {
	return isRibuE(x) && x.tag !== tag
}


function isRibuE(x: unknown): x is E {
	return typeof x === "object" && x !== null && RibuE in x && "tag" in x
}
