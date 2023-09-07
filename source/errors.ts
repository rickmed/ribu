type E<Name extends string = string> = NodeJS.ErrnoException & {
	readonly name: Name
}

export function E<Name extends string = string>(name: Name, err: Error | NodeJS.ErrnoException): Name<Name> {
	err.name = name
	return err as E<typeof name>
}


const CANC_OK = "CancelledOK" as const

export type ECancOK = E<typeof CANC_OK>

export function ECancOK() {
	let newErr = Error()
	newErr.name = CANC_OK
	return newErr as ECancOK
}


type InOnCancel = {
	inBody?: Error,
	children?: Array<InOnCancel>
}

export type EUncaught = E<"UncaughtThrow"> & {
	data: {
		inBody?: Error,
		inOnCancel?: InOnCancel
	}
}


export function err(x: unknown): x is E {
	// add prop to E type so that check is fast. instanceof is slow
	return x instanceof Error
}

// @todo: accept an array of names
	// errIsNot(err, "ECanc", "EThrow")
export function errIsNot<E_, T extends Extract<E, E_>["name"]>(possiblyErr: E_, name: T): possiblyErr is Extract<E_, E_> & Exclude<E_, E_<T>> {
	return err(possiblyErr) && possiblyErr.name !== name
}
