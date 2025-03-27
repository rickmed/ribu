const RIBU_ERR_NAME = "Err"
export type Er = Err<typeof RIBU_ERR_NAME>

/**
 * Ribu Err Class
 *
 * Is instanceof Error but does not call super() because constructing an Error
 * is slow.
 *
 * @param fn The name of the job's generator function or the name of the function if
 *           the user wants to return Err objects in sync functions.
 * _oe:
 * 	Errors that occurred in onEnd() functions.
 */
export class Err<Name extends string = string> implements Error {

	readonly name: Name
	readonly message: string
	readonly fn: string
	// Errors from yield* job and/or from waiting children (both always ::Err)
	private _errs?: unknown  // unknown | unknown[]
	// Errors from onEnd() functions
	private _oe?: Error | Error[]

	constructor(name: Name, fnName: string, errs?: Err["_errs"], onEndErrs?: Err["_oe"], msg = "") {
		this.name = name
		this.message = msg
		this.fn = fnName
		// todo, instantiate one dummy RibuErr as VOID_LINK in system.ts
		this._oe = onEndErrs
		this._errs = errs
	}

	_addErr(error: Error) {
		const { _errs } = this
		if (_errs === undefined) {
			this._errs = error
		}
		else if (Array.isArray(_errs)) {
			(_errs as unknown[]).push(error)
		}
		else {
			this._errs = [_errs, error]
		}
		return this
	}

	get errors() {
		return this._errs
	}

	_addOnEndErr(error: Error) {
		const { _oe } = this
		if (_oe === undefined) {
			this._oe = error
		}
		else if (Array.isArray(_oe)) {
			_oe.push(error)
		}
		else {
			this._oe = [_oe, error]
		}
		return this
	}

	get stack(): string {
		// if first in _errors is not OnEndErr, then it was the callee
		return ""  // todo
	}

	get onEndErrors() {
		return Array.isArray(this._oe) ? this._oe : [this._oe]
	}

	isCancOK() {
		return this instanceof CancOK
	}

	// todo: implement this
	// Err<Name extends string>(name: Name, fn = "", msg = "") {
	// 	return new Err(name, fn, this, msg)
	// }
}

// Make (errInstance instanceof Error) === true
Object.setPrototypeOf(Err.prototype, Error.prototype)

export function _Err(fnName: string, errs?: Err["_errs"], onEndErrs?: Err["_oe"], msg = "") {
	return new Err(RIBU_ERR_NAME, fnName, errs, onEndErrs, msg)
}

export function UserErrCtor<Name extends string>(name: Name, fnName = "", msg = "", ribuErr?: Err): Err<Name> {
	return new Err<Name>(name, fnName, ribuErr, undefined, msg)
}

export class CancOK extends Err {
	constructor() {
		super("CancOK", "")
	}
}
export const CANC_OK = new CancOK()


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
