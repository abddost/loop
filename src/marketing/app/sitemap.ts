import type { MetadataRoute } from "next"
import { siteUrl } from "../lib/site"

export const dynamic = "force-static"

export default function sitemap(): MetadataRoute.Sitemap {
	const lastModified = new Date()

	return [
		{
			url: siteUrl,
			lastModified,
			changeFrequency: "weekly",
			priority: 1,
		},
		{
			url: `${siteUrl}/download`,
			lastModified,
			changeFrequency: "weekly",
			priority: 0.8,
		},
	]
}
