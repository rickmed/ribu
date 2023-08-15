export const UNSET: unique symbol = Symbol("ribu val unset")
export type UNSET = typeof UNSET

export const PARK = "P" as const
export type PARK = typeof PARK

export const RESUME = "R" as const
export type RESUME = typeof RESUME

export const genCtor = (function* () { }).constructor