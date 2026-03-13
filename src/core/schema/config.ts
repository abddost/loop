import { z } from "zod"

export const AppConfigSchema = z.object({
	theme: z.enum(["dark", "light"]).default("dark"),
	defaultAgent: z.string().default("build"),
	defaultModel: z
		.object({
			providerId: z.string(),
			modelId: z.string(),
		})
		.nullable()
		.default(null),
})

export type AppConfig = z.infer<typeof AppConfigSchema>

export const DEFAULT_CONFIG: AppConfig = {
	theme: "dark",
	defaultAgent: "build",
	defaultModel: null,
}
