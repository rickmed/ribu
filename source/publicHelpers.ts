// import { ch, type Ch } from "./channel.mjs"
// import { go, cancel, type Prc } from "./process.mjs"

// /**
//  * Race several processes.
//  * @todo: implemented when first returns error.
//  * Returns the first process that finishes succesfully, ie,
//  * if the race winner finishes with errors, it is ignored.
//  * The rest (unfinished) are cancelled.
//  */
// export function race(...prcS: Prc[]): Ch {

// 	const done = ch<unknown>()

// 	let prcSDone: Array<Ch> = []
// 	for (const prc of prcS) {
// 		prcSDone.push(prc.done)
// 	}

// 	for (const chan of prcSDone) {

// 		go(function* _race() {

// 			const prcResult: unknown = yield chan

// 			// remove the winner prc from prcS so that the remainning can be cancelled
// 			prcS.splice(prcS.findIndex(prc => prc.done == chan), 1)

// 			go(function* () {
// 				yield cancel(...prcS)
// 			})

// 			yield done.put(prcResult)
// 		})

// 	}

// 	return done
// }