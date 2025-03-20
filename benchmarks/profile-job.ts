import { go } from "../source/index.js"
import { nSequentialJobs0Deep } from "./dummy-jobs.js"

await go(nSequentialJobs0Deep, 100_000, 0)
