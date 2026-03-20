import { existsSync, readFileSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import type { Skill } from "@core/schema/skill"
import { createLogger } from "../logger"
import { Workspace } from "../workspace"

const log = createLogger("skill")

// ── Frontmatter Parser ───────────────────────────────────────────────────────

function parseFrontmatter(content: string): { name?: string; description?: string; body: string } {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
	if (!match) return { body: content }
	const yaml = match[1]
	const body = match[2]
	const name = yaml.match(/^name:\s*(.+)$/m)?.[1]?.trim()
	const description = yaml.match(/^description:\s*(.+)$/m)?.[1]?.trim()
	return { name, description, body }
}

// ── Directory Scanning ───────────────────────────────────────────────────────

interface SkillSource {
	dir: string
	scope: "project" | "global"
}

function skillSources(): SkillSource[] {
	const wsDir = Workspace.dir()
	return [
		{ dir: join(wsDir, ".loop", "skills"), scope: "project" },
		{ dir: join(wsDir, ".claude", "skills"), scope: "project" },
		{ dir: join(homedir(), ".config", "loop", "skills"), scope: "global" },
	]
}

function scanDir(source: SkillSource): Skill[] {
	const { dir, scope } = source
	if (!existsSync(dir)) return []

	const skills: Skill[] = []
	let entries: string[]
	try {
		entries = readdirSync(dir)
	} catch (err) {
		log.warn("Failed to read skill directory", { dir, error: err as Error })
		return []
	}

	for (const entry of entries) {
		const skillFile = join(dir, entry, "SKILL.md")
		if (!existsSync(skillFile)) continue

		try {
			const content = readFileSync(skillFile, "utf-8")
			const fm = parseFrontmatter(content)
			skills.push({
				id: entry,
				name: fm.name ?? entry,
				description: fm.description ?? "",
				path: skillFile,
				scope,
			})
		} catch (err) {
			log.warn("Failed to parse skill", { path: skillFile, error: err as Error })
		}
	}

	return skills
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Discover all available SKILL.md files across project and global directories.
 * Project-local skills take precedence over global ones on name collision.
 */
export function discover(): Skill[] {
	const sources = skillSources()
	const seen = new Map<string, Skill>()

	for (const source of sources) {
		for (const skill of scanDir(source)) {
			// Project skills are scanned first, so only set if not already present
			if (!seen.has(skill.id)) {
				seen.set(skill.id, skill)
			}
		}
	}

	return [...seen.values()]
}

/**
 * Load a skill by id. Returns XML-wrapped content for system prompt injection,
 * or undefined if the skill is not found.
 */
export function load(id: string): string | undefined {
	const skills = discover()
	const skill = skills.find((s) => s.id === id || s.name === id)
	if (!skill) return undefined

	try {
		const content = readFileSync(skill.path, "utf-8")
		const fm = parseFrontmatter(content)
		const skillDir = dirname(skill.path)
		return `<skill_content name="${skill.name}">\n${fm.body}\nBase directory: ${skillDir}\n</skill_content>`
	} catch (err) {
		log.warn("Failed to load skill", { id, error: err as Error })
		return undefined
	}
}

/**
 * Returns XML-formatted listing of available skills for system prompt injection.
 * Returns empty string if no skills are found.
 */
export function listForPrompt(): string {
	const skills = discover()
	if (skills.length === 0) return ""

	const entries = skills
		.map((s) => `<skill name="${s.name}" description="${s.description}" />`)
		.join("\n")
	return `<available-skills>\n${entries}\n</available-skills>`
}

/**
 * Returns all skill directories for permission whitelisting.
 */
export function dirs(): string[] {
	const skills = discover()
	return skills.map((s) => dirname(s.path))
}
