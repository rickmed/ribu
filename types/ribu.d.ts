import { BroadcastCh } from "../source/ribu.mjs"
import { YIELD_VAL, Yieldable, PutFn } from "./_ribu"


export as namespace Ribu


type Ch<TVal = undefined> = {
   put: PutFn<TVal>
   get rec(): YIELD_VAL,
}

type Proc = {
   done: Ch
   cancel: () => Ch
}

type Gen<Rec = unknown> =
   Generator<Yieldable, void, Rec>
