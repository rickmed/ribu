const RIBU_ERR_KIND = "_RibuErr$"
type RibuErrKind = typeof RIBU_ERR_KIND
export type Err<Kind = RibuErrKind> = _Err & { $err: Kind }

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type InnerErr = Error | _Err | {} | null | undefined
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
export class _Err {

	$err: string
	readonly fn: string
	_errs?: InnerErrs
	readonly msg?: string

	constructor(kind = RIBU_ERR_KIND, fnName = "", errs?: _Err["_errs"], msg?: string) {
		this.$err = kind
		this.fn = fnName
		if (errs) {
			this._errs = errs
		}
		if (msg) {
			this.msg = msg
		}
	}

	_addErr(error: Error | _Err) {
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
		return new _Err(kind, fnName, this, msg) as Err<Kind>
	}
}


export type ErrX<K extends string, P> = Err<K> & P

type NoRibuErrKeys<P> = P & {
	[K in keyof _Err]?: never
}

export function Err<Kind extends string>(
	kind: Kind,
	msg?: string,
	fnName?: string
): Err<Kind>
export function Err<Kind extends string, P extends object>(
	kind: Kind,
	payload: NoRibuErrKeys<P>,
	msg?: string,
	fnName?: string
): ErrX<Kind, P>
export function Err<Kind extends string, P extends object>(
	kind: Kind,
	payload?: NoRibuErrKeys<P>,
	msg?: string,
	fnName?: string
): ErrX<Kind, P> | Err<Kind> {
	const err = new _Err(kind, fnName, undefined, msg)
	if (payload) {
		Object.assign(err, payload)
		return err as ErrX<Kind, P>
	}
	return err as Err<Kind>
}

export class Public_Err extends _Err {
	constructor(fnName = "", msg?: string) {
		super(undefined, fnName, undefined, msg)
	}
}


export const ERR_CANC_OK = new _Err("ErrCancOk")
export type ErrCancOk = _Err & {
	readonly $err: "ErrCancOk"
}


export function isErr<Kind>(x: unknown): x is { $err: Kind } {
	return typeof x === "object" && x !== null && "$err" in x
}

export function errIs<X, Kind extends Extract<X, Err<string>>["$err"]>(x: X, kind: Kind): x is Extract<X, Err<Kind>> {
	return isErr<Kind>(x) && x.$err === kind
}

export function errIsNot<X, Kind extends Extract<X, Err<string>>["$err"]>(x: X, kind: Kind): x is Exclude<X, Err<Kind>> {
	return isErr<Kind>(x) && x.$err === kind
}

export function _Er(fnName: string, errs?: _Err["_errs"], msg?: string) {
	return new _Err(RIBU_ERR_KIND, fnName, errs, msg)
}

export function _E<Kind extends string> (
	kind: Kind,
	fnName?: string,
	errs?: _Err["_errs"],
	msg?: string,
) {
	return new _Err(kind, fnName, errs, msg) as Err<Kind>
}
