/* eslint-disable */
import util from "util"

if (process.env.DEBUG === "true") {
	// @ts-ignore
	globalThis.zz = debugPrint
}

function debugPrint(obj: unknown) {
	console.log(util.inspect(cleanObject(obj), { depth: null, compact: false }))
}

function cleanObject(obj: any): any {
	if (Array.isArray(obj)) {
	  return obj
		 .map(cleanObject)
		 .filter((item) => item !== undefined && item !== null);
	} else if (obj && typeof obj === 'object') {
	  // Convert Error to plain object
	  if (obj instanceof Error) {
		 const { name, message, ...rest } = obj;
		 return cleanObject({ name, message, ...rest });
	  }

	  const result: any = {};
	  for (const [key, value] of Object.entries(obj)) {
		 if (
			value === '' ||
			value === undefined ||
			value === null ||
			key === 'stack'
		 ) {
			continue;
		 }
		 const cleanedValue = cleanObject(value);
		 if (cleanedValue !== undefined && cleanedValue !== null) {
			result[key] = cleanedValue;
		 }
	  }
	  return result;
	}

	return obj;
}