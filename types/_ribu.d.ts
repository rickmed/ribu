import {YIELD} from "../source/core.mjs"

/* ===  Clocks ============================================================== */
type VoidCB = () => void
type SetTimeout = (cb: VoidCB, ms: number) => void


/** === Generators ========================================================== */
type Yield = typeof YIELD
type Yieldable = Yield | Promise<unknown>
type Gen_or_GenFn = Ribu.Gen | (() => Ribu.Gen)

export as namespace _Ribu
