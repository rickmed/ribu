import {go, Ev, type Job, E} from "../source/index.mjs"
import dns from "node:dns/promises"
import net from "node:net"
import { Socket } from "node:net"
import { ArrSet } from "../source/data-structures.mjs"
import { runningJob } from "../source/system.mjs"
import { PARKED } from "../source/job.mjs"

/* Happy EyeBalls algorithm:
	- launch attempt
	- if any inFlight attempt fails or timeout expires, launch another concurrent attempt
	- cancel everything when first attempt is succesful
		- and return the socket
		- if all attempts fail, return an Error.
*/
export function* happyEB(hostName: string, port: number, delay: number = 300) {

	const addrs = (yield dns.resolve4(hostName)) as string[]

	if (addrs.length === 0) {
		return E("NoAddressesFromDNS")
	}

	let addrsIdx = addrs.length
	const fails = new Ev()
	const connectJobs = new Pool()

	go(function* () {
		for (;;) {
			if (--addrsIdx) {
				const j = connect("d")
				// connectJobs.add()
			}
			else {
				return
			}
			yield fails.timeout(delay)
		}
	})

	while (connectJobs.count) {
		const job: Job = yield connectJobs.rec  // no yield*
		if (job.val instanceof Socket) {
			yield connectJobs.cancel()
			return job.val
		}
		fails.emit()
	}

	return Error("All attempted connections failed")
}


/* hardest is a thing that dynamically add/receives from jobs.  */

// DONE
	// need a pool to:
		// cancel() rest on success
		// receive from any of them

	// Pool
		// subscribe to passed jobs in constructor immediately

class Pool<_Job extends Job> {

	constructor(
		private jobsStore = new ArrSet
	) {}
	inFlight = 0
	waitingJob!: _Job

	get count() {
		return this.inFlight
	}

	get rec(): typeof PARKED {
		this.waitingJob = runningJob() as _Job
		return PARKED
	}

	add(job: _Job) {
		job.onDone(doneJob => {
			this.waitingJob._resume(doneJob.val)
		})
	}

	// if I want go(), I need a reference to an array of Jobs to add/delete
		// could also be useful for long running jobs who add/remove jobs dynamically
}



// who is this job child of??
function connect(addrs: string) {
	const socket = new net.Socket()
	const job = Job()

	job.onEnd(() => socket.destroy())

	socket.on("error", e => {
		job.settle(e)
		// or
		job.settleErr(e)  // guarantees that prc resolves with Error (ie, wraps e if not instance of Error)
	})

	socket.on("connect", () => {
		job.settle(socket)
	})

	socket.connect(443, addrs)
	return job
}



/* using higher level primitives */
// todo
// function* happyEB_v2() {}
