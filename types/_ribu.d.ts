import {YIELD_VAL as YIELD_VAL} from "../source/core.mjs"

/* ===  Clocks ============================================================== */
type VoidCB = () => void
type SetTimeout = (cb: VoidCB, ms: number) => void


/** === Generators ========================================================== */
type Yieldable = typeof YIELD_VAL | Promise<unknown>
type Gen_or_GenFn = Ribu.Gen | (() => Ribu.Gen) 

export as namespace _Ribu
