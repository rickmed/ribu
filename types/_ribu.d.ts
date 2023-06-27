import {YIELD_VAL} from "../source/core.mjs"
import { Prc } from "../source/Prc.mjs"
import { Csp } from "../source/Csp.mjs/index.js"


type Csp = Csp

type Prc = Prc

/** === Generator ========================================================== */

type YIELD = typeof YIELD_VAL as const

type Yieldable = YIELD | Promise<unknown>

type GenFn<Rec = unknown> = (this?: Ports) => // GenFn must not have args
   Gen<Rec>
   
type Gen_or_GenFn = Ribu.Gen | GenFn

export as namespace _Ribu
