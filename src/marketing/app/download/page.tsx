import type { Metadata } from "next"
import Link from "next/link"
import { DownloadList } from "../../components/download-list"
import { siteDescription } from "../../lib/site"

export const metadata: Metadata = {
	title: "Download",
	description: "Download Loop AI desktop installers for macOS, Windows, and Linux.",
	alternates: {
		canonical: "/download",
	},
	openGraph: {
		title: "Download Loop AI",
		description: "Loop AI desktop installers for macOS, Windows, and Linux.",
		url: "/download",
	},
}

export default function DownloadPage() {
	return (
		<main>
			<section className="section download-hero">
				<p className="eyebrow">Installers</p>
				<h1 className="display">Download Loop AI.</h1>
				<p className="body-large">{siteDescription}</p>
				<Link href="/" className="pill pill-light">
					Back to overview
				</Link>
			</section>
			<section className="section">
				<DownloadList />
			</section>
		</main>
	)
}
