import { go, sleep, RibuGen, isErr } from "ribu"

type Ctx = {
	req: Request,
	res: Response,
}

type ReqHandler = (ctx: Ctx) => RibuGen

function* httpSupervisor() {
	for (;;) {
		const connection = yield* connectionsCh.rec
		const ctx = Ctx(connection)
		// if a request handling failed, it doesn't trigger the
		// cancellation of siblings
		go(reqHandlerSup, reqHandler, ctx)
	}
}


function* reqHandlerSup(reqHandler: ReqHandler, ctx: Ctx) {
	const res = yield* go(appReqHandler, ctx).err
	if (isErr(res)) {
		// ctx.connection.close() or something
		return
	}
	if (ctx.connectionClosed) {
		return
	}
	yield* ctx.res.write(res) // or something
}




function* reqHandler(ctx: Ctx) {
	console.log("do something with req/res", ctx.req.url)
	yield* sleep(1)  // some db query or something
	return ctx
}

const withLogReqHandler = (reqHandler: typeof reqHandler) =>
	function* (ctx: Ctx) {
		const start = Date.now()
		yield* go(reqHandler, ctx).err
		const ms = Date.now() - start
		ctx.req.set("X-Response-Time", `${ms}ms`)
	}


const appReqHandler = withLogReqHandler(reqHandler)


const res = await go(httpSupervisor).promErr
if (res.err) {
	console.error("something really bad happened", res.err)
	process.exit(1)
}
console.log("server done, bye")
