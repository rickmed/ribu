import { CSP, _wait, _go, _Ch } from "./core.mjs"

const csp = new CSP()

export const go = _go(csp)
export const Ch = _Ch(csp)
export const wait = _wait(globalThis.setTimeout, csp)