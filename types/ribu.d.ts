import { BroadcastCh } from "../source/ribu.mjs"
import { YIELD_VAL, Yieldable, Ch } from "./_ribu"


type Proc = {
   done: Ch
   cancel: (deadline?: number) => Ch
}

type Gen<Rec = unknown> =
   Generator<Yieldable, void, Rec>

export as namespace Ribu
