"use client"

import { githubRepo, releasesUrl } from "./site"

export interface ReleaseAsset {
	name: string
	browser_download_url: string
	size?: number
}

export interface Release {
	tag_name: string
	html_url: string
	published_at?: string
	assets: ReleaseAsset[]
}

const apiUrl = `https://api.github.com/repos/${githubRepo}/releases/latest`
const cacheKey = `loop-latest-release:${githubRepo}`

export async function fetchLatestRelease(): Promise<Release> {
	const cached = sessionStorage.getItem(cacheKey)
	if (cached) return JSON.parse(cached) as Release

	const response = await fetch(apiUrl, {
		headers: {
			Accept: "application/vnd.github+json",
		},
	})

	if (!response.ok) {
		throw new Error(`Could not load latest release: ${response.status}`)
	}

	const data = (await response.json()) as Release
	sessionStorage.setItem(cacheKey, JSON.stringify(data))
	return data
}

export function pickAsset(assets: ReleaseAsset[], suffixes: string[]): ReleaseAsset | null {
	for (const suffix of suffixes) {
		const match = assets.find((asset) => asset.name.endsWith(suffix))
		if (match) return match
	}
	return null
}

export { releasesUrl }
