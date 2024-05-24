import {go, Ev, type Job, E, newJob, cancel} from "../source/index.mjs"
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
	const fails = Ev()
	const connectJobs = new Pool()

	go(function* () {
		for (;;) {
			addrsIdx--
			if (addrsIdx < 0) {
				return
			}
			connectJobs.add(connect(addrs[addrsIdx]!))
			yield fails.timeout(delay)
		}
	})

	while (connectJobs.count) {
		const job = (yield connectJobs.rec) as Job
		if (job.val instanceof Socket) {
			yield connectJobs.cancel()
			return job.val
		}
		fails.emit()
	}

	return Error("All attempted connections failed")
}


class Pool<_Job extends Job> {

	constructor(
		private jobsStore: ArrSet<Job> = new ArrSet
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
		this.jobsStore.add(job)
		job._onDone(doneJob => {
			this.jobsStore.delete(doneJob)
			this.waitingJob._resume(doneJob.val)
		})
	}

	cancel() {
		return cancel(this.jobsStore.arr)
	}
}


function connect(addrs: string) {
	const socket = new net.Socket()
	const job = newJob()

	job.onEnd(() => socket.destroy())

	socket.on("error", e => {
		job.settle(e)  // job will fail if settle value instanceof Error
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
