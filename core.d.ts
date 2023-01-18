// type Chan_Operation =
type Yieldable = Promise<unknown>

// type Gen<Yield = Yieldable, Rec = number, Ret = number> =
//    Generator<Yield, Ret, Rec>

// type Gen<Yield = Yieldable, Rec = number, Ret = number> =
//    Generator<Yield, Ret, Rec>

export type GoGen = Generator | (() => Generator)