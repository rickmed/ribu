import { YIELD_VAL as _YIELD_VAL,  Prc as _Prc } from "../source/Prc.mjs"
import { Csp as _Csp } from "../source/Csp.mjs"
import { Proc, Ch } from "./ribu"


export as namespace _Ribu


/** === Csp ================================================================ */

type Csp = _Csp


/** === Prc ================================================================ */

type Prc = _Prc

type CancelScope = {
   $deadline: Proc,
   $onCancel?: Prc,
   childSCancelDone?: Ch,
}


/** === Chan ================================================================ */

type Put<TChVal> =
   (...args: (TChVal extends undefined ? [] : [TChVal])) =>
      YIELD_VAL

type Dispatch<TChVal> =
(...args: (TChVal extends undefined ? [] : [TChVal])) =>
   void | never


/** === Generator =========================================================== */

type YIELD_VAL = typeof _YIELD_VAL

type Yieldable = YIELD_VAL | Promise<unknown>

// GenFn must not have args. Otherwise, use Ribu.Gen
type GenFn<Rec = unknown> = () => Ribu.Gen<Rec>

type Gen_or_GenFn = Ribu.Gen | GenFn


/** === go() =========================================================== */

type Conf<TKs extends string> = {
   [K in TKs]:
      K extends keyof Prc ? never :
      K extends "deadline" ? number :
      Ch
}

type Ports<TConfKs extends string> =
   Omit<Conf<TConfKs>, "deadline">