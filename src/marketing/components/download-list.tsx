"use client"

import { useEffect, useState } from "react"
import { type Release, fetchLatestRelease, pickAsset, releasesUrl } from "../lib/releases"

const platformGroups = [
	{
		name: "macOS",
		note: "DMG installers",
		options: [
			{ label: "Apple Silicon", detail: "arm64", suffixes: ["-arm64.dmg"] },
			{ label: "Intel", detail: "x64", suffixes: ["-x64.dmg"] },
		],
	},
	{
		name: "Windows",
		note: "NSIS installer",
		options: [{ label: "Windows 10, 11", detail: "x64", suffixes: ["-x64.exe", ".exe"] }],
	},
	{
		name: "Linux",
		note: "AppImage",
		options: [{ label: "Linux", detail: "x86_64", suffixes: [".AppImage"] }],
	},
]

function formatSize(bytes?: number): string {
	if (!bytes) return ""
	const mb = bytes / 1024 / 1024
	return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`
}

export function DownloadList() {
	const [release, setRelease] = useState<Release | null>(null)
	const [error, setError] = useState(false)

	useEffect(() => {
		fetchLatestRelease()
			.then(setRelease)
			.catch(() => setError(true))
	}, [])

	return (
		<div className="download-list">
			<div className="release-meta">
				<span>
					{release?.tag_name
						? `Latest release ${release.tag_name}`
						: error
							? "Release data unavailable"
							: "Loading latest release"}
				</span>
				<a href={release?.html_url ?? releasesUrl}>GitHub releases</a>
			</div>

			<div className="download-grid">
				{platformGroups.map((group) => (
					<section className="download-platform card" key={group.name}>
						<div className="download-platform-head">
							<h2>{group.name}</h2>
							<span>{group.note}</span>
						</div>
						<div className="download-options">
							{group.options.map((option) => {
								const asset = release ? pickAsset(release.assets ?? [], option.suffixes) : null
								return (
									<a
										className="download-option"
										href={asset?.browser_download_url ?? releasesUrl}
										key={`${group.name}-${option.label}`}
									>
										<span>
											<strong>{option.label}</strong>
											<small>{option.detail}</small>
										</span>
										<em>{asset ? formatSize(asset.size) || "Download" : "Download"}</em>
									</a>
								)
							})}
						</div>
					</section>
				))}
			</div>
		</div>
	)
}
