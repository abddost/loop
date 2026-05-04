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
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes — long enough to avoid hammering the GitHub API, short enough that a fresh release shows up almost immediately.

interface CacheEntry {
	data: Release
	cachedAt: number
}

export async function fetchLatestRelease(): Promise<Release> {
	const cached = sessionStorage.getItem(cacheKey)
	if (cached) {
		try {
			const entry = JSON.parse(cached) as CacheEntry
			if (entry?.data && Date.now() - entry.cachedAt < CACHE_TTL_MS) {
				return entry.data
			}
		} catch {
			// fall through to refetch on malformed cache
		}
	}

	const response = await fetch(apiUrl, {
		headers: {
			Accept: "application/vnd.github+json",
		},
	})

	if (!response.ok) {
		throw new Error(`Could not load latest release: ${response.status}`)
	}

	const data = (await response.json()) as Release
	const entry: CacheEntry = { data, cachedAt: Date.now() }
	sessionStorage.setItem(cacheKey, JSON.stringify(entry))
	return data
}

export function pickAsset(
	assets: ReleaseAsset[],
	suffixes: string[],
	exclude: string[] = [],
): ReleaseAsset | null {
	for (const suffix of suffixes) {
		const match = assets.find(
			(asset) =>
				asset.name.endsWith(suffix) && !exclude.some((ex) => asset.name.endsWith(ex)),
		)
		if (match) return match
	}
	return null
}

export { releasesUrl }
