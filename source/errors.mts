/*
_op: the name of the job's generator function or the name of the function if
	the user wants to return E objects in sync functions.
- If something threw and it's not ::Error, then it's wapped in ::RibuE.

- User can extend RibuE object with additional properties, eg, like Nodejs:
	{
		errno: -2,
		code: 'ENOENT',
		syscall: 'open',
		path: './dummy.txt',
	}
*/

// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
type CauseErr = RibuE | Error | unknown

export const ERR_TAG = "{err!}"

export class RibuE<Name extends string = string> implements Error {

	[ERR_TAG] = 1 as const
	declare errors?: Error[]
	declare cause?: CauseErr

	constructor(
		readonly name: Name,
		readonly message: string,
		readonly _op: string,
		cause?: CauseErr,
		errors?: Error[],
	) {
		if (cause) {
			this.cause = cause
		}
		if (errors) {
			this.errors = errors
		}
	}

	get stack(): string {
		return ""  // todo
	}

	E<Name extends string>(name: Name, op = "", msg = "") {
		return E(name, op, msg, this)
	}
}

// make "instanceof Error" work
Object.setPrototypeOf(RibuE.prototype, Error.prototype)

// todo: Error & RibuE<Name> ??
export type E<Name extends string = string> = Error & RibuE<Name>

export function E<Name extends string>(name: Name, op = "", msg = "", cause?: RibuE): E<Name> {
	return new RibuE<Name>(name, msg, op, cause)
}

export class ECancOK extends RibuE<"CancOK"> {
	constructor(op: string, msg: string) {
		super("CancOK", msg, op)
	}
}

export class Err extends RibuE<"Err"> {
	constructor(cause?: CauseErr, jobName = "", errors?: Error[], msg = "") {
		super("Err", msg, jobName, cause, errors)
	}
}

export class ETimedOut extends RibuE<"TimedOut"> {
	constructor(op: string) {
		super("TimedOut", "", op)
	}
}


export function isE(x: unknown): x is RibuE {
	return x !== null && typeof x === "object" && ERR_TAG in x
}

export const isRibuE = isE

type EE = RibuE<string>

export function errIsNot<X, T extends Extract<X, EE>["name"]>(x: X, name: T): x is Extract<X, EE> & Exclude<X, RibuE<T>> {
	return x instanceof Error && x.name !== name
}

export function errIs<X, T extends Extract<X, EE>["name"]>(x: X, name: T): x is Extract<X, RibuE<T>> {
	return x instanceof Error && x.name === name
}
