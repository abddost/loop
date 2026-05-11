import Link from "next/link"
import { PlatformDownloadButton } from "../components/platform-download"

type ProviderItem = {
	name: string
	image?: string
	alt?: string
	initials?: string
	compact?: boolean
}

const providerItems: ProviderItem[] = [
	{ name: "Claude Code", image: "/assets/claude.svg", alt: "Claude logo" },
	{ name: "Codex", image: "/assets/codex-color.png", alt: "Codex logo" },
	{ name: "Cursor", image: "/assets/cursor.png", alt: "Cursor logo" },
	{ name: "GitHub Copilot", image: "/assets/githubcopilot.svg", alt: "GitHub Copilot logo" },
	{
		name: "OpenCode",
		image: "/assets/opencode-logo-dark.svg",
		alt: "OpenCode logo",
		compact: true,
	},
]

const features = [
	{
		title: "Use your existing subscriptions",
		body: "Connect Cursor, Claude Code, Codex, and provider accounts from one desktop interface.",
	},
	{
		title: "85+ model providers",
		body: "Bring API keys or supported account auth for hosted and open model providers.",
	},
	{
		title: "Desktop workflow",
		body: "Projects, sessions, terminal output, file changes, and agent tasks stay in one workspace.",
	},
]

export default function HomePage() {
	return (
		<main>
			<section className="section hero">
				<div className="hero-copy">
					<h1 className="display hero-title">
						Every coding agent.
						<br />
						One quiet desktop.
					</h1>
					<p className="body-large hero-description">
						Loop AI brings Codex, Claude Code, Cursor integration, and 85+ providers into a minimal
						desktop app for everyday coding work.
					</p>
					<div className="hero-actions">
						<PlatformDownloadButton />
						<Link href="/download" className="pill pill-light">
							All installers
						</Link>
					</div>
				</div>

				<div className="hero-panel card" aria-label="Loop AI application screenshot">
					<img
						src="/assets/loop-sample.png"
						alt="Loop AI desktop app showing project sessions and an agent response"
						width={3024}
						height={1716}
						loading="eager"
						fetchPriority="high"
					/>
				</div>
			</section>

			<section className="section provider-strip" aria-label="Supported coding integrations">
				<div className="provider-copy">
					<p className="eyebrow">Integrations</p>
					<p>
						Codex, Claude Code, Cursor, GitHub Copilot, OpenCode, and provider APIs in one place.
					</p>
				</div>
				<div className="provider-logos">
					{providerItems.map((provider) => (
						<div className="provider-chip" key={provider.name}>
							<span className={`provider-icon${provider.compact ? " provider-icon-compact" : ""}`}>
								{provider.image ? (
									<img src={provider.image} alt={provider.alt ?? ""} width={22} height={22} />
								) : (
									<span>{provider.initials}</span>
								)}
							</span>
							{provider.name}
						</div>
					))}
					<div className="provider-chip provider-chip-muted">85+ providers</div>
				</div>
			</section>

			<section className="section feature-section" id="features">
				<div className="section-heading">
					<p className="eyebrow">What it does</p>
					<h2 className="display">A focused workspace for agent sessions.</h2>
					<p>
						Keep model access, terminal output, file changes, and session history close without
						switching between separate coding tools.
					</p>
				</div>
				<div className="feature-grid">
					{features.map((feature) => (
						<article className="feature-card card" key={feature.title}>
							<h3>{feature.title}</h3>
							<p>{feature.body}</p>
						</article>
					))}
				</div>
			</section>

			<section className="section download-band card">
				<div>
					<p className="eyebrow">Download</p>
					<h2 className="display">Install Loop AI for your platform.</h2>
				</div>
				<Link href="/download" className="pill pill-warm">
					View installers
				</Link>
			</section>
		</main>
	)
}
