/** @param {number} ms */
export function promSleep(ms) {
	return new Promise(res => {
		setTimeout(() => {
			res(true)
		}, ms)
	})
}
