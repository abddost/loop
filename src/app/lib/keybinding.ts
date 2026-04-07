/**
 * Keybinding engine — pure utilities with no React/Zustand dependencies.
 *
 * Keybind strings use the format: "mod+shift+s"
 *   - mod = Meta on macOS, Ctrl elsewhere
 *   - ctrl, alt, shift, meta = explicit modifiers
 *   - Remaining token = the key (lowercase)
 *
 * Multiple combos separated by comma: "mod+k,mod+shift+k"
 */

// ── Platform ───────────────────────────────────────────────────

export const IS_MAC =
	typeof navigator === "object" && /(Mac|iPod|iPhone|iPad)/.test(navigator.platform)

// ── Types ──────────────────────────────────────────────────────

export interface Keybind {
	key: string
	ctrl: boolean
	meta: boolean
	shift: boolean
	alt: boolean
}

// ── Normalize ──────────────────────────────────────────────────

export function normalizeKey(key: string): string {
	if (key === ",") return "comma"
	if (key === "+") return "plus"
	if (key === " ") return "space"
	return key.toLowerCase()
}

// ── Parse ──────────────────────────────────────────────────────

/** Parse a keybind config string into structured Keybind objects. */
export function parseKeybind(config: string): Keybind[] {
	if (!config || config === "none") return []

	return config.split(",").map((combo) => {
		const parts = combo.trim().toLowerCase().split("+")
		const kb: Keybind = { key: "", ctrl: false, meta: false, shift: false, alt: false }

		for (const part of parts) {
			switch (part) {
				case "ctrl":
				case "control":
					kb.ctrl = true
					break
				case "meta":
				case "cmd":
				case "command":
					kb.meta = true
					break
				case "mod":
					if (IS_MAC) kb.meta = true
					else kb.ctrl = true
					break
				case "alt":
				case "option":
					kb.alt = true
					break
				case "shift":
					kb.shift = true
					break
				default:
					kb.key = part
					break
			}
		}

		return kb
	})
}

// ── Match ──────────────────────────────────────────────────────

/** Check if a keyboard event matches any of the parsed keybinds. */
export function matchKeybind(keybinds: Keybind[], event: KeyboardEvent): boolean {
	const eventKey = normalizeKey(event.key)

	for (const kb of keybinds) {
		if (
			kb.key === eventKey &&
			kb.ctrl === event.ctrlKey &&
			kb.meta === event.metaKey &&
			kb.shift === event.shiftKey &&
			kb.alt === event.altKey
		) {
			return true
		}
	}

	return false
}

// ── Signature ──────────────────────────────────────────────────

/**
 * Compute a fast-lookup signature string from modifier bitmask + key.
 * Format: "key:mask" where mask = ctrl(1) | meta(2) | shift(4) | alt(8)
 */
function signature(
	key: string,
	ctrl: boolean,
	meta: boolean,
	shift: boolean,
	alt: boolean,
): string {
	const mask = (ctrl ? 1 : 0) | (meta ? 2 : 0) | (shift ? 4 : 0) | (alt ? 8 : 0)
	return `${key}:${mask}`
}

/** Compute signature from a KeyboardEvent for O(1) command lookup. */
export function signatureFromEvent(event: KeyboardEvent): string {
	return signature(
		normalizeKey(event.key),
		event.ctrlKey,
		event.metaKey,
		event.shiftKey,
		event.altKey,
	)
}

/** Compute signature from a parsed Keybind. */
export function signatureFromKeybind(kb: Keybind): string {
	return signature(kb.key, kb.ctrl, kb.meta, kb.shift, kb.alt)
}

// ── Format (display) ───────────────────────────────────────────

const MAC_MODIFIERS: Record<string, string> = {
	ctrl: "\u2303", // ⌃
	alt: "\u2325", // ⌥
	shift: "\u21E7", // ⇧
	meta: "\u2318", // ⌘
}

const KEY_SYMBOLS: Record<string, string> = {
	arrowup: "\u2191",
	arrowdown: "\u2193",
	arrowleft: "\u2190",
	arrowright: "\u2192",
	backspace: "\u232B",
	delete: "\u2326",
	enter: "\u21A9",
	escape: "Esc",
	space: "\u2423",
	tab: "\u21E5",
	comma: ",",
	plus: "+",
	"`": "`",
	"\\": "\\",
}

function formatKeyDisplay(key: string): string {
	const lower = key.toLowerCase()
	if (KEY_SYMBOLS[lower]) return KEY_SYMBOLS[lower]
	return key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1)
}

/** Format a keybind config string for display: "mod+b" → "⌘B" (Mac) or "Ctrl+B" (Win). */
export function formatKeybind(config: string): string {
	if (!config || config === "none") return ""
	const keybinds = parseKeybind(config)
	if (keybinds.length === 0) return ""

	const kb = keybinds[0]
	const parts: string[] = []

	if (IS_MAC) {
		if (kb.ctrl) parts.push(MAC_MODIFIERS.ctrl)
		if (kb.alt) parts.push(MAC_MODIFIERS.alt)
		if (kb.shift) parts.push(MAC_MODIFIERS.shift)
		if (kb.meta) parts.push(MAC_MODIFIERS.meta)
		if (kb.key) parts.push(formatKeyDisplay(kb.key))
		return parts.join("")
	}

	if (kb.ctrl) parts.push("Ctrl")
	if (kb.alt) parts.push("Alt")
	if (kb.shift) parts.push("Shift")
	if (kb.meta) parts.push("Win")
	if (kb.key) parts.push(formatKeyDisplay(kb.key))
	return parts.join("+")
}

/** Format a keybind into individual parts for rendering as kbd badges. */
export function formatKeybindParts(config: string): string[] {
	if (!config || config === "none") return []
	const keybinds = parseKeybind(config)
	if (keybinds.length === 0) return []

	const kb = keybinds[0]
	const parts: string[] = []

	if (IS_MAC) {
		if (kb.ctrl) parts.push(MAC_MODIFIERS.ctrl)
		if (kb.alt) parts.push(MAC_MODIFIERS.alt)
		if (kb.shift) parts.push(MAC_MODIFIERS.shift)
		if (kb.meta) parts.push(MAC_MODIFIERS.meta)
	} else {
		if (kb.ctrl) parts.push("Ctrl")
		if (kb.alt) parts.push("Alt")
		if (kb.shift) parts.push("Shift")
		if (kb.meta) parts.push("Win")
	}

	if (kb.key) parts.push(formatKeyDisplay(kb.key))
	return parts
}

// ── Editable target detection ──────────────────────────────────

/** Returns true if the event target is an editable element (input, textarea, contenteditable, xterm). */
export function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false
	if (target.isContentEditable) return true
	if (target.closest("[contenteditable='true']")) return true
	if (target.closest("input, textarea, select")) return true
	// xterm terminal containers capture their own keyboard input
	if (target.closest(".xterm")) return true
	return false
}

// ── Record keybind from event ──────────────────────────────────

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"])

/** Record a keybind string from a KeyboardEvent (for the settings key capture UI). */
export function recordKeybindFromEvent(event: KeyboardEvent): string | undefined {
	if (MODIFIER_KEYS.has(event.key)) return undefined

	const parts: string[] = []
	const mod = IS_MAC ? event.metaKey : event.ctrlKey
	if (mod) parts.push("mod")
	if (IS_MAC && event.ctrlKey) parts.push("ctrl")
	if (!IS_MAC && event.metaKey) parts.push("meta")
	if (event.altKey) parts.push("alt")
	if (event.shiftKey) parts.push("shift")

	const key = normalizeKey(event.key)
	if (!key) return undefined
	parts.push(key)

	return parts.join("+")
}
