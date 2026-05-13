"use client"

import { useEffect, useState } from "react"
import { fetchLatestRelease, pickAsset, releasesUrl } from "../lib/releases"

type Platform = {
	os: "mac" | "win" | "linux"
	label: string
	suffixes: string[]
	exclude?: string[]
	comingSoon?: boolean
}

/**
 * Browsers report `Intel Mac OS X` in the User-Agent on Apple Silicon as
 * well, so the UA string alone can't tell us anything. Probe the WebGL
 * renderer instead — Apple Silicon GPUs identify themselves as "Apple GPU"
 * or "Apple M1/M2/M3" while Intel/AMD Macs return their respective vendor.
 *
 * If WebGL is unavailable or returns nothing, default to arm64. Apple
 * stopped selling Intel Macs in 2023; in 2026 the modal Mac is Apple
 * Silicon, so arm64 is the safer default than Intel.
 */
function isAppleSiliconMac(): boolean {
	try {
		const canvas = document.createElement("canvas")
		const gl =
			(canvas.getContext("webgl") as WebGLRenderingContext | null) ??
			(canvas.getContext("experimental-webgl") as WebGLRenderingContext | null)
		if (!gl) return true
		const ext = gl.getExtension("WEBGL_debug_renderer_info")
		if (!ext) return true
		const renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? "")
		// "Apple GPU", "Apple M1", "Apple M2 Max", etc.
		if (/Apple\b/.test(renderer)) return true
		// Recognised Intel/AMD chips → really Intel.
		if (/Intel|AMD|Radeon/i.test(renderer)) return false
		return true
	} catch {
		return true
	}
}

function detectPlatform(): Platform | null {
	const ua = window.navigator.userAgent
	if (/Windows/i.test(ua)) {
		return {
			os: "win",
			label: "Windows — coming soon",
			suffixes: ["-x64.exe", ".exe"],
			comingSoon: true,
		}
	}
	if (/Macintosh|Mac OS X/i.test(ua)) {
		const appleSilicon = isAppleSiliconMac()
		return {
			os: "mac",
			label: "Download for macOS",
			// On Intel, exclude -arm64.dmg so the ".dmg" fallback can't accidentally
			// match the ARM build (asset order from the GitHub API is not guaranteed).
			suffixes: appleSilicon ? ["-arm64.dmg", ".dmg"] : ["-x64.dmg", ".dmg"],
			exclude: appleSilicon ? undefined : ["-arm64.dmg"],
		}
	}
	if (/Linux/i.test(ua)) {
		// UA reports the kernel arch on Chromium-based browsers; Firefox sometimes
		// omits it. Default to x64 (largest desktop share). The suffix list tries
		// .deb first (Debian/Ubuntu dominate), falls back to .rpm.
		const isArm = /aarch64|arm64/i.test(ua)
		return {
			os: "linux",
			label: "Download for Linux",
			suffixes: isArm ? ["-arm64.deb", "-arm64.rpm"] : ["-x64.deb", "-x64.rpm"],
		}
	}
	return null
}

export function PlatformDownloadButton() {
	const [label, setLabel] = useState("Download Loop AI")
	const [href, setHref] = useState(releasesUrl)
	const [platform, setPlatform] = useState<Platform["os"] | null>(null)
	const [comingSoon, setComingSoon] = useState(false)

	useEffect(() => {
		const detected = detectPlatform()
		if (!detected) return

		setPlatform(detected.os)
		setLabel(detected.label)

		if (detected.comingSoon) {
			setComingSoon(true)
			setHref("/download")
			return
		}

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
					<img src="/assets/apple.png" alt="" width={64} height={64} />
				) : platform === "win" ? (
					<img src="/assets/windows.png" alt="" width={64} height={64} />
				) : platform === "linux" ? (
					<img src="/assets/linux.png" alt="" />
				) : (
					"dl"
				)}
			</span>
			{label}
			{comingSoon ? <span className="badge-soon hero-download-badge">Soon</span> : null}
		</a>
	)
}
