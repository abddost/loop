import { z } from "zod"

export const ToolResultSchema = z.object({
	output: z.string(),
	metadata: z.record(z.unknown()).optional(),
})

export type ToolResult = z.infer<typeof ToolResultSchema>
