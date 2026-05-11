import type { Metadata, Viewport } from "next"
import Link from "next/link"
import type { ReactNode } from "react"
import "./globals.css"
import { discordUrl, githubUrl, siteDescription, siteUrl } from "../lib/site"

export const viewport: Viewport = {
	width: "device-width",
	initialScale: 1,
	themeColor: "#080807",
}

export const metadata: Metadata = {
	metadataBase: new URL(siteUrl),
	applicationName: "Loop AI",
	title: {
		default: "Loop AI - Desktop Coding Assistant",
		template: "%s | Loop AI",
	},
	description: siteDescription,
	keywords: [
		"Loop AI",
		"desktop coding assistant",
		"AI coding assistant",
		"Codex desktop app",
		"Claude Code desktop app",
		"Cursor integration",
		"AI model providers",
	],
	authors: [{ name: "Loop AI" }],
	creator: "Loop AI",
	publisher: "Loop AI",
	alternates: {
		canonical: "/",
	},
	openGraph: {
		type: "website",
		url: siteUrl,
		siteName: "Loop AI",
		title: "Loop AI - Desktop Coding Assistant",
		description: siteDescription,
		images: [
			{
				url: "/assets/loop-sample.png",
				width: 1600,
				height: 900,
				alt: "Loop AI desktop coding assistant interface",
			},
		],
	},
	twitter: {
		card: "summary_large_image",
		title: "Loop AI - Desktop Coding Assistant",
		description: siteDescription,
		images: ["/assets/loop-sample.png"],
	},
	robots: {
		index: true,
		follow: true,
		googleBot: {
			index: true,
			follow: true,
			"max-video-preview": -1,
			"max-image-preview": "large",
			"max-snippet": -1,
		},
	},
	icons: {
		icon: [
			{ url: "/assets/favicon.ico", sizes: "any" },
			{ url: "/assets/favicon-16x16.png", sizes: "16x16", type: "image/png" },
			{ url: "/assets/favicon-32x32.png", sizes: "32x32", type: "image/png" },
			{ url: "/assets/favicon-48x48.png", sizes: "48x48", type: "image/png" },
			{ url: "/assets/favicon-96x96.png", sizes: "96x96", type: "image/png" },
			{ url: "/assets/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
			{ url: "/assets/android-chrome-512x512.png", sizes: "512x512", type: "image/png" },
		],
		shortcut: [{ url: "/assets/favicon.ico" }],
		apple: [{ url: "/assets/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
	},
}

export default function RootLayout({ children }: { children: ReactNode }) {
	const organizationJsonLd = {
		"@context": "https://schema.org",
		"@type": "SoftwareApplication",
		name: "Loop AI",
		applicationCategory: "DeveloperApplication",
		operatingSystem: "macOS, Windows, Linux",
		description: siteDescription,
		url: siteUrl,
		downloadUrl: `${siteUrl}/download`,
		image: `${siteUrl}/assets/loop-sample.png`,
		offers: {
			"@type": "Offer",
			price: "0",
			priceCurrency: "USD",
		},
	}

	return (
		<html lang="en">
			<body>
				<script
					type="application/ld+json"
					// biome-ignore lint/security/noDangerouslySetInnerHtml: Static schema markup for search engines.
					dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
				/>
				<div className="site-shell">
					<header className="site-header">
						<nav className="site-nav" aria-label="Main navigation">
							<Link href="/" className="brand" aria-label="Loop AI home">
								<img src="/assets/logo.png" alt="logo" style={{ width: "90px", height: "90px" }} />
							</Link>
							<div className="nav-links">
								<Link href={discordUrl} className="hide-mobile">
									Discord
								</Link>
								<Link href={githubUrl} className="hide-mobile">
									GitHub
								</Link>
								<Link href="/download" className="pill pill-dark">
									Download
								</Link>
							</div>
						</nav>
					</header>
					{children}
					<footer className="site-footer">
						<div className="footer-inner">
							<span>© {new Date().getFullYear()} Loop AI</span>
							<div className="footer-links">
								<Link href={discordUrl}>Discord</Link>
								<Link href={githubUrl}>GitHub</Link>
								<Link href="/download">Installers</Link>
							</div>
						</div>
					</footer>
				</div>
			</body>
		</html>
	)
}
