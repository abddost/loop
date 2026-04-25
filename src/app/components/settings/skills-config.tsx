import type { Skill } from "@core/schema/skill"
import { ArrowUpRight } from "@openai/apps-sdk-ui/components/Icon"
import { useEffect, useState } from "react"
import { apiClient } from "../../lib/api-client"
import { openFile } from "../../lib/editor"

/**
 * Skills settings tab. Read-only list of available skills.
 * Skills are loaded on mount via the API — no dedicated store needed.
 */
export function SkillsConfig({ className }: { className?: string }) {
	const [skills, setSkills] = useState<Skill[]>([])
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		apiClient
			.get<Skill[]>("/skills")
			.then(setSkills)
			.catch((err) => {
				console.error("[skills:fetch]", err)
			})
			.finally(() => setLoading(false))
	}, [])

	return (
		<div className={className}>
			{/* Header */}
			<div className="mb-6">
				<h1 className="text-xl font-semibold text-foreground">Skills</h1>
				<p className="mt-1 text-xs text-muted">
					Skills are specialized capabilities that help the agent accomplish specific tasks.
				</p>
			</div>

			{/* Loading */}
			{loading && (
				<div className="rounded-xl border border-border px-5 py-10 text-center text-sm text-muted">
					Loading skills...
				</div>
			)}

			{/* Empty state */}
			{!loading && skills.length === 0 && (
				<div className="rounded-xl border border-border px-5 py-10 text-center text-sm text-muted">
					<p>No skills found. Create a skill by placing a SKILL.md file in any of:</p>
					<div className="mt-2 space-y-1">
						<code className="block font-mono text-foreground">
							.loop/skills/{"<name>"}/SKILL.md
						</code>
						<code className="block font-mono text-foreground">
							.claude/skills/{"<name>"}/SKILL.md
						</code>
						<code className="block font-mono text-foreground">
							~/.agents/skills/{"<name>"}/SKILL.md
						</code>
					</div>
				</div>
			)}

			{/* Skills list */}
			{!loading && skills.length > 0 && (
				<div className="el-card divide-y divide-[var(--separator)]">
					{skills.map((skill) => (
						<SkillRow key={skill.id} skill={skill} />
					))}
				</div>
			)}
		</div>
	)
}

function SkillRow({ skill }: { skill: Skill }) {
	const handleOpen = () => {
		openFile(skill.path)
	}

	return (
		<div className="flex items-center justify-between px-5 py-4">
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="text-sm font-medium text-foreground">{skill.name}</span>
					<span className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] font-medium text-muted">
						{skill.scope}
					</span>
				</div>
				<p className="mt-0.5 text-xs text-muted">{skill.description}</p>
			</div>
			<button
				type="button"
				onClick={handleOpen}
				className="el-btn-pill-sm flex shrink-0 items-center gap-1.5 !bg-transparent text-muted shadow-[var(--shadow-inset)] hover:text-foreground"
			>
				<span>Open in Editor</span>
				<ArrowUpRight className="h-3 w-3" aria-hidden="true" />
			</button>
		</div>
	)
}
