import { YIELD_VAL as _YIELD_VAL, Prc as _Prc } from "../source/Prc.mjs"
import { Csp as _Csp } from "../source/Csp.mjs"

type Csp = _Csp
type Prc = _Prc


/** === Chan ================================================================ */

type Ch<TVal = undefined> = {
   put: PutFn<TVal>
   get rec(): YIELD_VAL,
}

type PutFn<TChVal> = (...args: (TChVal extends undefined ? [] : [TChVal])) => YIELD_VAL


/** === Generator =========================================================== */

type YIELD_VAL = typeof _YIELD_VAL

type Yieldable = YIELD_VAL | Promise<unknown>

// GenFn must not have args. Otherwise, use Ribu.Gen
type GenFn<Rec = unknown> = () => Ribu.Gen<Rec>

type Gen_or_GenFn = Ribu.Gen | GenFn

type ProcShape = {
   [k in "cancel" | "done"]?: unknown
}

type Conf = {
   [k: string]: Ch
}

type EmptyObj = Record<never, never>

export as namespace _Ribu
