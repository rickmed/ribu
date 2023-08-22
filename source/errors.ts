type E<Name extends string = string> = NodeJS.ErrnoException & {
	readonly name: Name
}

export function E<Name extends string = string>(name: Name, ogErr: Error | NodeJS.ErrnoException): E<Name> {
	ogErr.name = name
	return ogErr as E<typeof name>
}


const CANC_OK = "CancelledOK" as const

export function ECancOK() {
	let newErr = Error()
	newErr.name = CANC_OK
	return newErr as E<typeof CANC_OK>
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
	return x instanceof Error
}


export function errIsNot<X, T extends Extract<X, E>["name"]>(x: X, name: T): x is Extract<X, E> & Exclude<X, E<T>> {
	return err(x) && x.name !== name
}
