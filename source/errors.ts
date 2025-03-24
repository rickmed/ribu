// so ts doesn't flatten unknown | unknown[] into unknown
type SingleValue = { __brand?: "single" }
type ArrayValue = [] & { __brand?: "array" }
type UnknownOrArrayOfUnknown = SingleValue | ArrayValue

/**
 * Ribu Err Class
 *
 * Is instanceof Error but does not call super() because constructing an Error
 * is slow.
 *
 * @param fn The name of the job's generator function or the name of the function if
 *           the user wants to return Err objects in sync functions.
 */
export class Err<Name extends string> implements Error {

	readonly name: Name
	readonly message: string
	readonly fn: string
	private _errors?: UnknownOrArrayOfUnknown

	constructor(name: Name, fnName: string, cause?: unknown, msg = "") {
		this.name = name
		this.message = msg
		this.fn = fnName
		this._errors = cause as UnknownOrArrayOfUnknown
	}

	addErr(maybeErr: unknown) {
		if (!this._errors) {
			this._errors = maybeErr as UnknownOrArrayOfUnknown
		}
		else if (Array.isArray(this._errors)) {
			(this._errors as unknown[]).push(maybeErr)
		}
		else {
			this._errors = [this._errors, maybeErr] as UnknownOrArrayOfUnknown
		}
		return this
	}

	get stack(): string {
		return ""  // todo
	}

	// todo: evaluate this, maybe it's confusing.
	get cause() {
		return Array.isArray(this._errors) ? this._errors[0] : this._errors
	}

	get errors() {
		return this._errors
	}

	_Err(fnName: string, cause?: unknown, msg = "") {
		return this.addErr(new Err("Err", fnName, cause, msg))
	}

	Err<Name extends string>(name: Name, fn = "", msg = "") {
		return new Err(name, fn, this, msg)
	}
}

// make (errInstance instanceof Error) === true
Object.setPrototypeOf(Err.prototype, Error.prototype)

export type RibuErr = Err<string>

export function _Err(cause: unknown, fnName: string, msg = "") {
	return new Err("Err", fnName, cause, msg)
}

export type OnEndErr = Err<"OnEndErr">
export function OnEndErr(cause: unknown, fnName: string, msg = ""): OnEndErr {
	return new Err("OnEndErr", fnName, cause, msg)
}

export type GenFnErr = Err<"GenFnErr">
export function GenFnErr(fnName: string, cause: unknown, msg = "") {
	return new Err("GenFnErr", fnName, cause, msg)
}

export class CancOK {}
export const CANC_OK = new CancOK()


export function userErrCtor<Name extends string>(name: Name, fnName = "", msg = "", cause?: unknown): Err<Name> {
	return new Err<Name>(name, fnName, cause, msg)
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
