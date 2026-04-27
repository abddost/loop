"use client"

import { useEffect, useState } from "react"
import { fetchLatestRelease, pickAsset, releasesUrl } from "../lib/releases"

type Platform = {
	os: "mac" | "win" | "linux"
	label: string
	suffixes: string[]
	exclude?: string[]
}

function detectPlatform(): Platform | null {
	const ua = window.navigator.userAgent
	if (/Windows/i.test(ua)) {
		return { os: "win", label: "Download for Windows", suffixes: ["-x64.exe", ".exe"] }
	}
	if (/Macintosh|Mac OS X/i.test(ua)) {
		const isAppleSilicon = /arm64|aarch64/i.test(ua)
		return {
			os: "mac",
			label: "Download for macOS",
			// On Intel, exclude -arm64.dmg so the ".dmg" fallback can't accidentally
			// match the ARM build (asset order from the GitHub API is not guaranteed).
			suffixes: isAppleSilicon ? ["-arm64.dmg", ".dmg"] : ["-x64.dmg", ".dmg"],
			exclude: isAppleSilicon ? undefined : ["-arm64.dmg"],
		}
	}
	if (/Linux/i.test(ua)) {
		return { os: "linux", label: "Download for Linux", suffixes: [".AppImage"] }
	}
	return null
}

export function PlatformDownloadButton() {
	const [label, setLabel] = useState("Download Loop AI")
	const [href, setHref] = useState(releasesUrl)
	const [platform, setPlatform] = useState<Platform["os"] | null>(null)

	useEffect(() => {
		const detected = detectPlatform()
		if (!detected) return

		setPlatform(detected.os)
		setLabel(detected.label)

		fetchLatestRelease()
			.then((release) => {
				const asset = pickAsset(release.assets ?? [], detected.suffixes, detected.exclude)
				if (asset) setHref(asset.browser_download_url)
			})
			.catch(() => {
				setHref(releasesUrl)
			})
	}, [])

	return (
		<a className="pill pill-dark hero-download" href={href} data-platform={platform ?? undefined}>
			<span className="platform-mark" aria-hidden="true">
				{platform === "mac" ? (
					<img src="/assets/apple.png" alt="" width={14} height={14} />
				) : platform === "win" ? (
					"win"
				) : platform === "linux" ? (
					"linux"
				) : (
					"dl"
				)}
			</span>
			{label}
		</a>
	)
}
