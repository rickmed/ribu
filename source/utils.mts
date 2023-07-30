export function set<O, K extends keyof O>(obj: O, k: K, val: O[K]): void {
   obj[k] = val
}