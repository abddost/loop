import { z } from "zod"

// ── Action Categories ──────────────────────────────────────────

export const ACTION_CATEGORIES = ["general", "session", "navigation", "terminal"] as const
export type ActionCategory = (typeof ACTION_CATEGORIES)[number]

// ── Action IDs ─────────────────────────────────────────────────

export const ACTION_IDS = [
	// General
	"settings.open",
	"commandPalette.open",
	// Session
	"session.new",
	"message.previous",
	"message.next",
	"input.focus",
	// Navigation
	"sidebar.toggle",
	"filePanel.toggle",
	// Terminal
	"terminal.toggle",
] as const

export type ActionId = (typeof ACTION_IDS)[number]

// ── Action Metadata ────────────────────────────────────────────

export interface ActionMeta {
	title: string
	category: ActionCategory
	/** When true, the keybind still fires even if the focus is in an input/textarea. */
	ignoreEditableCheck?: boolean
	/** When true, this binding is handled by Electron menu accelerators — skip DOM listener. */
	electronHandled?: boolean
}

export const ACTION_METADATA: Record<ActionId, ActionMeta> = {
	"settings.open": {
		title: "Open Settings",
		category: "general",
		electronHandled: true,
	},
	"commandPalette.open": {
		title: "Command Palette",
		category: "general",
	},
	"session.new": {
		title: "New Session",
		category: "session",
	},
	"message.previous": {
		title: "Previous Message",
		category: "session",
	},
	"message.next": {
		title: "Next Message",
		category: "session",
	},
	"input.focus": {
		title: "Focus Input",
		category: "session",
		ignoreEditableCheck: true,
	},
	"sidebar.toggle": {
		title: "Toggle Sidebar",
		category: "navigation",
	},
	"filePanel.toggle": {
		title: "Toggle File Panel",
		category: "navigation",
	},
	"terminal.toggle": {
		title: "Toggle Terminal",
		category: "terminal",
	},
}

// ── Default Keybindings ────────────────────────────────────────

export const DEFAULT_KEYBINDINGS: Record<ActionId, string> = {
	"settings.open": "mod+comma",
	"commandPalette.open": "mod+shift+p",
	"session.new": "mod+n",
	"message.previous": "mod+arrowup",
	"message.next": "mod+arrowdown",
	"input.focus": "ctrl+l",
	"sidebar.toggle": "mod+\\",
	"filePanel.toggle": "mod+b",
	"terminal.toggle": "ctrl+`",
}

// ── Schema (user overrides only) ───────────────────────────────

/**
 * Stores only user overrides. An empty record means "all defaults."
 * Values are keybind strings (e.g. "mod+shift+s") or "none" to disable.
 */
export const KeybindingOverridesSchema = z.record(z.string(), z.string()).default({})
