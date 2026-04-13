import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, isAbsolute, join, resolve } from "node:path"
import type { Skill } from "@core/schema/skill"
import { read as readConfig } from "../config"
import { createLogger } from "../logger"
import { Workspace } from "../workspace"

const log = createLogger("skill")

// ── Constants ───────────────────────────────────────────────────────────────

/** External tool directories that may contain skills (compatible with Claude Code, agents). */
const EXTERNAL_DIRS = [".claude", ".agents"] as const
const SKILL_FILENAME = "SKILL.md"

// ── Frontmatter Parser ──────────────────────────────────────────────────────

interface Frontmatter {
	name?: string
	description?: string
	body: string
}

/**
 * Parse YAML frontmatter from a SKILL.md file.
 * Handles multiline values via block scalar detection.
 */
function parseFrontmatter(content: string): Frontmatter {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
	if (!match) return { body: content }

	const yaml = match[1]
	const body = match[2]
	const fields: Record<string, string> = {}

	for (const line of yaml.split("\n")) {
		const kv = line.match(/^(\w+):\s*(.+)$/)
		if (kv) fields[kv[1]] = kv[2].trim()
	}

	return { name: fields.name, description: fields.description, body }
}

// ── Recursive Scanner ───────────────────────────────────────────────────────

/**
 * Recursively find all SKILL.md files under `root`.
 * Returns absolute paths. Silently skips inaccessible directories.
 */
function findSkillFiles(root: string): string[] {
	if (!existsSync(root)) return []

	const results: string[] = []
	const stack = [root]

	while (stack.length > 0) {
		const dir = stack.pop()!
		let entries: string[]
		try {
			entries = readdirSync(dir)
		} catch {
			continue
		}

		for (const entry of entries) {
			const full = join(dir, entry)
			try {
				const stat = statSync(full)
				if (stat.isDirectory()) {
					stack.push(full)
				} else if (entry === SKILL_FILENAME) {
					results.push(full)
				}
			} catch {
				// Skip inaccessible entries (broken symlinks, permission errors)
			}
		}
	}

	return results
}

/**
 * Parse a single SKILL.md file into a Skill object.
 * Returns undefined if parsing fails.
 */
function parseSkillFile(skillPath: string, scope: "project" | "global"): Skill | undefined {
	try {
		const content = readFileSync(skillPath, "utf-8")
		const fm = parseFrontmatter(content)
		// Derive ID from the parent directory name (e.g. .../skills/review-pr/SKILL.md → "review-pr")
		const id = dirname(skillPath).split("/").pop() ?? skillPath
		return {
			id,
			name: fm.name ?? id,
			description: fm.description ?? "",
			path: skillPath,
			scope,
		}
	} catch (err) {
		log.warn("Failed to parse skill", { path: skillPath, error: err as Error })
		return undefined
	}
}

/**
 * Scan a directory for SKILL.md files and return parsed skills.
 */
function scanDir(root: string, scope: "project" | "global"): Skill[] {
	const files = findSkillFiles(root)
	const skills: Skill[] = []
	for (const file of files) {
		const skill = parseSkillFile(file, scope)
		if (skill) skills.push(skill)
	}
	return skills
}

// ── Directory Walking ───────────────────────────────────────────────────────

/**
 * Walk upward from `start` to `stop` (or filesystem root), yielding
 * each existing target directory found along the way.
 */
function* walkUp(targets: readonly string[], start: string, stop?: string): Generator<string> {
	let current = resolve(start)
	while (true) {
		for (const target of targets) {
			const candidate = join(current, target)
			if (existsSync(candidate)) {
				try {
					if (statSync(candidate).isDirectory()) yield candidate
				} catch {
					// Skip inaccessible
				}
			}
		}
		if (stop && resolve(current) === resolve(stop)) break
		const parent = dirname(current)
		if (parent === current) break // filesystem root
		current = parent
	}
}

// ── Skill Sources ───────────────────────────────────────────────────────────

/**
 * Collect all skill directories in priority order:
 * 1. Project-level: walk up from workspace dir looking for .loop/skills, .claude/skills, .agents/skills
 * 2. Global external: ~/.claude/skills, ~/.agents/skills
 * 3. Global config: ~/.loop/skills
 * 4. User-configured custom paths from config.skills.paths
 */
function collectSources(): Array<{ dir: string; scope: "project" | "global" }> {
	const sources: Array<{ dir: string; scope: "project" | "global" }> = []
	const home = homedir()

	// 1. Project-level: walk upward from workspace directory
	try {
		const wsDir = Workspace.dir()
		const project = Workspace.project()
		const stop = project.worktree ?? undefined

		// Walk up looking for .loop, .claude, .agents directories with skills/ subdirs
		for (const root of walkUp([".loop", ...EXTERNAL_DIRS], wsDir, stop)) {
			const skillsDir = join(root, "skills")
			if (existsSync(skillsDir)) {
				sources.push({ dir: skillsDir, scope: "project" })
			}
		}
	} catch {
		// Not inside workspace context — skip project-level sources
	}

	// 2. Global external directories: ~/.claude/skills, ~/.agents/skills
	for (const ext of EXTERNAL_DIRS) {
		const dir = join(home, ext, "skills")
		sources.push({ dir, scope: "global" })
	}

	// 3. Global config directory: ~/.loop/skills
	sources.push({ dir: join(home, ".loop", "skills"), scope: "global" })

	// 4. User-configured custom paths
	try {
		const config = readConfig()
		for (const raw of config.skills?.paths ?? []) {
			const expanded = raw.startsWith("~/") ? join(home, raw.slice(2)) : raw
			const dir = isAbsolute(expanded) ? expanded : resolve(expanded)
			sources.push({ dir, scope: "global" })
		}
	} catch {
		// Config may not be available
	}

	return sources
}

// ── Cache ───────────────────────────────────────────────────────────────────

let cachedSkills: Skill[] | null = null

/** Force the next `discover()` call to re-scan from disk. */
export function invalidate(): void {
	cachedSkills = null
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Discover all available SKILL.md files across project and global directories.
 * Project-local skills take precedence over global ones on ID collision.
 * Results are cached until `invalidate()` is called.
 */
export function discover(): Skill[] {
	if (cachedSkills) return cachedSkills

	const sources = collectSources()
	const seen = new Map<string, Skill>()

	for (const source of sources) {
		for (const skill of scanDir(source.dir, source.scope)) {
			// First occurrence wins (project sources are scanned first)
			if (!seen.has(skill.id)) {
				seen.set(skill.id, skill)
			} else {
				log.debug("Skipping duplicate skill", {
					id: skill.id,
					kept: seen.get(skill.id)!.path,
					skipped: skill.path,
				})
			}
		}
	}

	cachedSkills = [...seen.values()]
	log.info("Skill discovery complete", { count: cachedSkills.length })
	return cachedSkills
}

/**
 * Load a skill by id or name. Returns XML-wrapped content for tool output,
 * or undefined if the skill is not found.
 */
export function load(id: string): { content: string; dir: string } | undefined {
	const skills = discover()
	const skill = skills.find((s) => s.id === id || s.name === id)
	if (!skill) return undefined

	try {
		const raw = readFileSync(skill.path, "utf-8")
		const fm = parseFrontmatter(raw)
		const skillDir = dirname(skill.path)

		// Discover bundled files in the skill directory (scripts, templates, etc.)
		const bundledFiles = listBundledFiles(skillDir)
		const filesBlock =
			bundledFiles.length > 0
				? `\n<skill_files>\n${bundledFiles.map((f) => `<file>${f}</file>`).join("\n")}\n</skill_files>`
				: ""

		const content = [
			`<skill_content name="${skill.name}">`,
			`# Skill: ${skill.name}`,
			"",
			fm.body.trim(),
			"",
			`Base directory for this skill: ${skillDir}`,
			"Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.",
			bundledFiles.length > 0 ? "Note: file list is sampled." : "",
			filesBlock,
			"</skill_content>",
		]
			.filter(Boolean)
			.join("\n")

		return { content, dir: skillDir }
	} catch (err) {
		log.warn("Failed to load skill", { id, error: err as Error })
		return undefined
	}
}

/**
 * List up to 10 bundled files in a skill directory (excludes SKILL.md).
 */
function listBundledFiles(skillDir: string, limit = 10): string[] {
	const files: string[] = []
	const stack = [skillDir]

	while (stack.length > 0 && files.length < limit) {
		const dir = stack.pop()!
		let entries: string[]
		try {
			entries = readdirSync(dir)
		} catch {
			continue
		}

		for (const entry of entries) {
			if (files.length >= limit) break
			const full = join(dir, entry)
			try {
				const stat = statSync(full)
				if (stat.isDirectory()) {
					stack.push(full)
				} else if (entry !== SKILL_FILENAME) {
					files.push(full)
				}
			} catch {
				// Skip inaccessible
			}
		}
	}

	return files
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
