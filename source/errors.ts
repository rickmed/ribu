const RibuE = Symbol("RibuExc")

export const UNKNOWN = "Unknown"

export function E<Tag extends string>(tag: Tag, cause: Error): E<Tag> {
	return { tag, cause, [RibuE]: true as const}
}

export function EUnknown<Tag extends string>(tag: Tag, cause: Error): E<Tag> {
	return { tag, cause, [RibuE]: true as const}
}

export function EPrcCancelled(): ExcProcessCancelled {
	return { tag: "ProcessCancelled", [RibuE]: true }
}

export function exc<X>(x: X): x is Extract<X, EBase>
export function exc<X, T extends Extract<X, EBase>["tag"]>(x: X, tag?: T): x is Extract<X, EBase<T>>
export function exc<X, T extends Extract<X, EBase>["tag"]>(x: X, tag?: T): x is Extract<X, EBase<T>> {
	if (tag === undefined) {
		return x instanceof Error
	}
	return isRibuE(x) && x.tag === tag
}

export function excNot<X, T extends Extract<X, E>["tag"]>(x: X, tag: T): x is Extract<X, E> & Exclude<X, E<T>> {
	return isRibuE(x) && x.tag !== tag
}

function isRibuE(x: unknown): x is E {
	return typeof x === "object" && x !== null && RibuE in x && "tag" in x
}

type EBase<Tag extends string = string> = {
	readonly [RibuE]: true
	readonly tag: Tag
}

export type E<Tag extends string = string> = EBase<Tag> & {
	readonly cause: Error
}

export type ExcProcessCancelled = EBase<"ProcessCancelled">


/*
function readFile(x: string) {
	if (x === "one") {
		return E("ENOENT", Error())
	}
	if (x === "two") {
		return E("PERM_ERR", Error())
	}
	if (x === "3") {
		return E("Unknown", Error())
	}
	return "file2" as string
}

function recover(x: string) {
	if (x === "one") {
		return E("SOME_ERR", Error())
	}
	return "file" as string
}

function uploadFile(x: string) {
	if (x === "one") {
		return E("TIMEOUT", Error())
	}
	if (x === "two") {
		return E("NOPE", Error())
	}
	return true as boolean
}


function readFileWithErrHandling(filePath: string) {
	let res = readFile(filePath)

	// if (err(res)) {
	// 	if (err(res, "ENOENT")) {
	// 		const res2 = recover(filePath)
	// 		if (err(res2)) return res2
	// 		res = res2
	// 	}
	// 	else return res
	// }

	if (excNot(res, "ENOENT")) return res

	if (exc(res)) {
		const res2 = recover(filePath)
		if (exc(res2)) return res2
		res = res2
	}

	return res
}
 */