const RIBU_ERR_KIND = "$RibuErr$"
type RibuErrKind = typeof RIBU_ERR_KIND
export type Err<Kind extends string = RibuErrKind> = RibuErr<Kind>

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type InnerErr = Error | RibuErr | {} | null | undefined
type InnerErrs = InnerErr | InnerErr[]

/**
 * Ribu Err Class
 *
 * Is instanceof Error but does not call super() because constructing an Error
 * is slow.
 *
 * @param kind The kind of the error.
 * @param fn The name of the job's generator function or the name of the function if
 *           the user wants to return Err objects in sync functions.
 * _oe:
 * 	Errors that occurred in onEnd() functions.
 */
export class RibuErr<Kind = unknown> {

	readonly fn: string
	readonly kind: Kind
	private _errs?: InnerErrs
	readonly msg?: string

	constructor(kind: Kind, fnName = "", errs?: RibuErr["_errs"], msg?: string) {
		this.fn = fnName
		this.kind = kind
		if (errs) {
			this._errs = errs
		}
		if (msg) {
			this.msg = msg
		}
	}

	_addErr(error: Error | RibuErr) {
		const { _errs } = this
		if (_errs === undefined) {
			this._errs = error
		}
		else if (Array.isArray(_errs)) {
			_errs.push(error)
		}
		else {
			this._errs = [_errs, error]
		}
		return this
	}

	get errors() {
		return this._errs
	}

	get stack(): string {
		// if first in _errors is not OnEndErr, then it was the callee
		return ""  // todo
	}

	Err<Kind extends string>(kind: Kind, msg?: string, fnName?: string) {
		return new RibuErr<Kind>(kind, fnName, this, msg) as Err<Kind>
	}
}

export function _Err(fnName: string, errs?: RibuErr["_errs"], msg?: string) {
	return new RibuErr(RIBU_ERR_KIND, fnName, errs, msg) as Err
}

// todo: add a way to add payload.
export function Err<Kind extends string>(kind: Kind, fnName?: string, msg?: string, errs?: RibuErr["_errs"]) {
	return new RibuErr<Kind>(kind, fnName, errs, msg) as Err<Kind>
}

export const E_CANC_OK = new RibuErr("ECancOk")
export type ECancOk = RibuErr & {
	readonly kind: "ECancOk"
}

export function isErr(x: unknown): x is RibuErr<string> {
	return x instanceof RibuErr
}

type EE = RibuErr<string>

export function errIsNot<X, T extends Extract<X, EE>["kind"]>(kind: T, x: X): x is Extract<X, EE> & Exclude<X, RibuErr<T>> {
	return x instanceof RibuErr && x.kind !== kind
}

export function errIs<X, T extends Extract<X, EE>["kind"]>(kind: T, x: X): x is Extract<X, RibuErr<T>> {
	return x instanceof RibuErr && x.kind === kind
}