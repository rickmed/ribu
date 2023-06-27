import { Chan } from "../source/channels.mjs"
import { Proc } from "../source/Proc.mjs"


type Ch<T = undefined> = Chan<T>

type Proc = {
   cancel: (deadline?: number) => Ch
   done: Ch
}

type Gen<Rec = unknown> =
   Generator<_Ribu.Yieldable, void, Rec>

export as namespace Ribu
