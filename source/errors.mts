/*
_op: the name of the job's generator function or the name of the function if
	the user wants to return E objects in sync functions.
- If something threw and it's not ::Error, then it's wapped in ::RibuE.

- User can extend RibuE object with additional propertie, eg, like Nodejs:
	{
		errno: -2,
		code: 'ENOENT',
		syscall: 'open',
		path: './dumm.txt',
	}
*/

export class RibuE<Name extends string = string> implements Error {

	readonly cause?: Error

	constructor(
		readonly name: Name,
		readonly _op: string,
		readonly message: string,
		cause?: Error
	) {
		if (cause) this.cause = cause
	}

	E<Name extends string>(name: Name, op = "", msg = "") {
		return E(name, op, msg, this)
	}

	get stack(): string {
		return ""  // todo: this is temporary for sophi to work (reads .stack)
	}
}

Object.setPrototypeOf(RibuE.prototype, Error.prototype)


export type E<Name extends string = string> = Error & RibuE<Name>

export function E<Name extends string>(name: Name, op = "", msg = "", cause?: RibuE): E<Name> {
	return new RibuE<Name>(name, op, msg, cause)
}

export class CancOKClass extends RibuE<"CancOK"> {
	constructor(msg: string, jName: string) {
		super("CancOK", jName, msg)
	}
}

export type ECancOK = Error & RibuE<"CancOK">

export function newECancOK(msg: string, jName: string): ECancOK {
	return new CancOKClass(msg, jName)
}


export class ErrClass extends RibuE<"Err"> {

	readonly errors?: Error[]

	constructor(msg = "", cause?: Error, errs?: Error[], jName = "") {
		super("Err", jName, msg, cause)
		if (errs) this.errors = errs
	}
}

export type Err = Error & RibuE<"Err">

export function newErr(msg = "", cause?: Error, errs?: Error[], jName = ""): Err {
	return new ErrClass(msg, cause, errs, jName)
}


type EE = RibuE<string>

export function errIsNot<X, T extends Extract<X, EE>["name"]>(x: X, name: T): x is Extract<X, EE> & Exclude<X, RibuE<T>> {
	return x instanceof Error && x.name !== name
}

export function errIs<X, T extends Extract<X, EE>["name"]>(x: X, name: T): x is Extract<X, RibuE<T>> {
	return x instanceof Error && x.name === name
}

export function isE(x: unknown): x is RibuE {
	return x instanceof RibuE
}
