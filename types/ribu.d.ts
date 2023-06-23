import {Chan} from "../source/core.mjs"

type Ch<T = unknown> = Chan<T>

type Gen<Rec = unknown> =
   Generator<_Ribu.Yieldable, void, Rec>

export as namespace Ribu
