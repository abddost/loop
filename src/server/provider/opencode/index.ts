export {
	OPENCODE_PROVIDER_ID,
	OPENCODE_PROVIDER_NAME,
	OPENCODE_PROVIDER_DESCRIPTION,
	OPENCODE_MODEL_SLUG_SEPARATOR,
	encodeOpenCodeModelId,
	parseOpenCodeModelId,
} from "./constants"
export {
	connectOpenCode,
	type OpenCodeConnection,
} from "./client"
export {
	detectOpenCode,
	rescanOpenCode,
	getCachedOpenCodeDetection,
	type OpenCodeDetection,
	type OpenCodeDiscoveredModel,
} from "./detect"
export { OpenCodeRegistry } from "./registry"
