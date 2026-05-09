"use client"

import { useEffect, useState } from "react"
import { type Release, fetchLatestRelease, pickAsset, releasesUrl } from "../lib/releases"

type PlatformOption = {
	label: string
	detail: string
	suffixes: string[]
	exclude?: string[]
}

type PlatformGroup = {
	name: string
	note: string
	options: PlatformOption[]
	comingSoon?: boolean
}

const platformGroups: PlatformGroup[] = [
	{
		name: "macOS",
		note: "DMG installers",
		options: [
			{ label: "Apple Silicon", detail: "arm64", suffixes: ["-arm64.dmg"] },
			// Fallback ".dmg" handles releases (like v0.1.0) where electron-builder
			// omits the -x64 suffix for the default arch. Exclude -arm64.dmg so we
			// don't accidentally serve the ARM build to Intel users.
			{
				label: "Intel",
				detail: "x64",
				suffixes: ["-x64.dmg", ".dmg"],
				exclude: ["-arm64.dmg"],
			},
		],
	},
	{
		name: "Windows",
		note: "NSIS installer",
		comingSoon: true,
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
					<section
						className={`download-platform card${group.comingSoon ? " download-platform-soon" : ""}`}
						key={group.name}
						aria-disabled={group.comingSoon || undefined}
					>
						<div className="download-platform-head">
							<div className="download-platform-title">
								<h2>{group.name}</h2>
								{group.comingSoon ? <span className="badge-soon">Coming soon</span> : null}
							</div>
							<span>{group.note}</span>
						</div>
						<div className="download-options">
							{group.options.map((option) => {
								const asset =
									release && !group.comingSoon
										? pickAsset(release.assets ?? [], option.suffixes, option.exclude)
										: null
								if (group.comingSoon) {
									return (
										<div
											className="download-option download-option-disabled"
											key={`${group.name}-${option.label}`}
											aria-disabled="true"
										>
											<span>
												<strong>{option.label}</strong>
												<small>{option.detail}</small>
											</span>
											<em>Coming soon</em>
										</div>
									)
								}
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
