/**
 * Ribu Err Class
 *
 * Is instanceof Error but does not call super() because constructing an Error
 * is slow.
 *
 * @param fn The name of the job's generator function or the name of the function if
 *           the user wants to return Err objects in sync functions.
 */
export class Err<Name extends string = string> implements Error {

	readonly name: Name
	readonly message: string
	readonly fn: string
	readonly cause?: unknown
	errors?: Error[]

	constructor(name: Name, message: string, fn: string, cause?: unknown, errors?: Error[]) {
		this.name = name
		this.message = message
		this.fn = fn
		this.cause = cause
		this.errors = errors
	}

	addError(err: Error) {
		if (!this.errors) {
			this.errors = []
		}
		this.errors.push(err)
		return this
	}

	get stack(): string {
		return ""  // todo
	}

	Err<Name extends string>(name: Name, fn = "", msg = "") {
		return userErrCtor(name, fn, msg, this)
	}
}

// make (errInstance instanceof Error) === true
Object.setPrototypeOf(Err.prototype, Error.prototype)

export function _Err(cause: unknown, fn: string) {
	return new Err("Err", "", fn, cause)
}

export class ECancOK extends Err<"CancOK"> {
	constructor(fnName: string) {
		super("CancOK", "", fnName)
	}
}

export class ThrownValIsNotError extends Err<"ThrownValIsNotError"> {
	constructor(cause: unknown) {
		super("ThrownValIsNotError", "", "", cause)
	}
}

export class ETimedOut extends Err<"TimedOut"> {
	constructor(fn: string) {
		super("TimedOut", "", fn)
	}
}



export function userErrCtor<Name extends string>(name: Name, fn = "", msg = "", cause?: unknown): Err<Name> {
	return new Err<Name>(name, msg, fn, cause)
}

export function isErr(x: unknown): x is Err<string> {
	return x instanceof Err
}

type EE = Err<string>

export function errIsNot<X, T extends Extract<X, EE>["name"]>(x: X, name: T): x is Extract<X, EE> & Exclude<X, Err<T>> {
	return x instanceof Error && x.name !== name
}

export function errIs<X, T extends Extract<X, EE>["name"]>(x: X, name: T): x is Extract<X, Err<T>> {
	return x instanceof Error && x.name === name
}
