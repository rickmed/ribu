import { go, E as Err, Ch } from "../source/index.js"
import dns from "node:dns/promises"
import net from "node:net"
import { Socket } from "node:net"
import { onEnd } from "../source/job.js"
import { OutCh } from "../source/channel.js"

/* Happy EyeBalls algorithm:
	- launch attempt + timeout
	- if any inFlight attempt fails or timeout expires, launch another concurrent attempt (+ new timeout)
	- cancel everything when first attempt is succesful
		- and return the socket
		- if all attempts fail, return an Error.
*/

export async function* happyEyeBalls(hostName: string, port: number, delay: number = 300) {

	const addresses = await dns.resolve4(hostName)
	const addressesLen = addresses.length

	if (addressesLen === 0) {
		return Err("NoAddressesFromDNS")
	}

	const ch = Ch<Socket | "FAILED" | "TIMED_OUT">()
	let addrsIdx = 0
	let inFlight = 0
	let timeout!: NodeJS.Timeout

	do {
		if (addrsIdx < addressesLen) {
			inFlight++
			connect(addresses[addrsIdx++]!, ch)
			timeout = setTimeout(() => ch.enQ("TIMED_OUT"), delay)
		}
		const result = yield* ch.rec
		clearTimeout(timeout)
		if (result instanceof Socket) return result
		if (result == "FAILED") inFlight--
	} while (inFlight > 0)

	return Error("All attempted connections failed")

	// resources like in-flight socket connection attempts will be cancelled on return
}


function connect(addrs: string, outCh: OutCh<Socket | "FAILED">) {
	const socket = new net.Socket()

	// onEnd adds a cancellation resource to sys.runningJob
	// todo, optimize to something like onEnd(socket.destroy) maybe
	onEnd(() => socket.destroy())

	let isConnected = false

	socket.on("connect", () => {
		isConnected = true
		outCh.enQ(socket)
	})

	socket.on("error", () => {
		if (!isConnected)	outCh.enQ("FAILED")

	})

	socket.connect(443, addrs)
}



// This version is closer to the natural specification but a bit less efficient
// since it adds an additional job.
export async function* happyEyeBalls_V2(hostName: string, port: number, delay: number = 300) {

	let addresses = await dns.resolve4(hostName)

	if (addresses.length === 0) {
		return Err("NoAddressesFromDNS")
	}

	const connectRes = Ch<Socket | "FAIL">()
	const failOrTimeout = Ch()
	let inFlight = 0
	let timeout!: NodeJS.Timeout

	const launchJob = go(function* launcher() {
		for (;;) {
			if (addresses.length == 0) {
				return
			}
			inFlight++
			connect(addresses.shift()!)
			timeout = setTimeout(() => failOrTimeout.enQ(), delay)
			yield* failOrTimeout.rec
			clearTimeout(timeout)
		}
	})

	while (inFlight) {
		const res = yield* connectRes.rec
		if (res instanceof Socket) {
			yield launchJob.cancel()
			clearTimeout(timeout)
			return res
		}
		inFlight--
		yield failOrTimeout.put()
	}

	return Error("All attempted connections failed")
	// resources like in-flight connection attempts will be cancelled on return

	function connect(addrs: string) {
		const socket = new net.Socket()

		// onEnd adds a cancellation resource to sys.runningJob
		// todo, optimize to something like onEnd(socket.destroy) maybe
		onEnd(() => socket.destroy())

		let isConnected = false

		socket.on("connect", () => {
			isConnected = true
			connectRes.enQ(socket)
		})

		socket.on("error", () => {
			if (!isConnected) connectRes.enQ("FAIL")
		})

		socket.connect(443, addrs)
	}
}
