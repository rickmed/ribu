const RIBU_ERR_KIND = "$RibuErr$"
type RibuErrKind = typeof RIBU_ERR_KIND
export type Er<Kind extends string = RibuErrKind> = RibuErr<Kind>

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

	$err: Kind
	readonly fn: string
	_errs?: InnerErrs
	readonly msg?: string

	constructor(kind: Kind, fnName = "", errs?: RibuErr["_errs"], msg?: string) {
		this.$err = kind
		this.fn = fnName
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
		return new RibuErr<Kind>(kind, fnName, this, msg) as Er<Kind>
	}
}

export function Err<Kind extends string>(kind: Kind, fnName?: string, msg?: string, errs?: RibuErr["_errs"]) {
	return new RibuErr<Kind>(kind, fnName, errs, msg) as Er<Kind>
}

export const E_CANC_OK = new RibuErr("ECancOk")
export type ECancOk = RibuErr & {
	readonly $err: "ECancOk"
}

export function isErr<Kind>(x: unknown): x is { $err: Kind } {
	return typeof x === "object" && x !== null && "$err" in x
}

export function errIsNot<X, K extends string>(kind: K, x: X):
	x is Exclude<X, { $err: K }>
{
	return isErr(x) && x.$err !== kind
}

export function errIs<X, K extends string>(kind: K, x: X):
	x is Extract<X, { $err: K }>
{
	return isErr(x) && x.$err === kind
}


export function _Err(fnName: string, errs?: RibuErr["_errs"], msg?: string): Er {
	return new RibuErr(RIBU_ERR_KIND, fnName, errs, msg)
}

export function _Er<Kind extends string>(
	kind: Kind,
	fnName?: string,
	errs?: RibuErr["_errs"],
	msg?: string,
) {
	return new RibuErr(kind, fnName, errs, msg)
}


// new stuff down here

function Err_v2<
	Kind extends string,
	P extends object,
>(kind: Kind, p: P): Er<Kind> & P {
	const baseErr = new RibuErr(kind)
	Object.assign(baseErr, p)
	return baseErr as Er<Kind> & P
}





// Base error interface with kind as a generic
export interface TypedErr<K extends string = string> extends RibuErr<K> {
	$err: K;
 }

// Enhanced error creation function with type erasure
export function Err_v3<
	K extends string,
	P extends object
 >(kind: K, payload: P): TypedErr<K> {
	const baseErr = new RibuErr(kind)
	return Object.assign(baseErr, payload) as TypedErr<K>
}

type MyErr2 = Er<"MyErr"> & { sysCode: number, fileName: string };
const myErr = Err_v2("MyErr", { sysCode: 1, fileName: "file1.ts" }) as MyErr2
const myErr2 = Err_v2("MyErr", { sysCode: 1, fileName: "file1.ts" })
