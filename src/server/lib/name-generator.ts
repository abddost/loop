const ADJECTIVES = [
	"bold",
	"calm",
	"dark",
	"fast",
	"keen",
	"neat",
	"pure",
	"rare",
	"safe",
	"warm",
	"blue",
	"cold",
	"deep",
	"fair",
	"glad",
	"kind",
	"pale",
	"rich",
	"soft",
	"wild",
	"cool",
	"deft",
	"fern",
	"gold",
	"iron",
	"jade",
	"lime",
	"moss",
	"opal",
	"pine",
] as const

const NOUNS = [
	"arch",
	"beam",
	"cave",
	"dawn",
	"edge",
	"fern",
	"glen",
	"haze",
	"isle",
	"jade",
	"knot",
	"lake",
	"mesa",
	"node",
	"oaks",
	"peak",
	"reef",
	"sage",
	"tide",
	"vale",
	"wave",
	"apex",
	"bark",
	"cove",
	"dune",
	"flux",
	"gate",
	"helm",
	"iris",
	"keel",
] as const

function pick<T>(arr: readonly T[]): T {
	return arr[Math.floor(Math.random() * arr.length)]
}

/** Generate a random adjective-noun name (e.g. "bold-arch"). */
export function randomName(): string {
	return `${pick(ADJECTIVES)}-${pick(NOUNS)}`
}
