import { type } from "os"
import { YIELD_VAL, Yieldable, Put, Dispatch } from "./_ribu"


export as namespace Ribu



type Proc<Ports> = _Ribu.PublicProc & Ports

type Gen<Rec = unknown> =
   Generator<Yieldable, void, Rec>

type Ch<TChVal = undefined> = {
   put: Put<TChVal>
   get rec(): YIELD_VAL,
   dispatch: Dispatch<TChVal>,
}
