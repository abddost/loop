import { ACTION_METADATA, type ActionId, DEFAULT_KEYBINDINGS } from "@core/schema/keybinding"
import { create } from "zustand"
import { immer } from "zustand/middleware/immer"
import {
	isEditableTarget,
	parseKeybind,
	signatureFromEvent,
	signatureFromKeybind,
} from "../lib/keybinding"
import { useConfigStore } from "./config-store"

// ── Types ──────────────────────────────────────────────────────

export interface CommandEntry {
	id: string
	handler: () => void
}

interface InternalCommand {
	id: string
	handler: () => void
}

interface KeybindingState {
	/** Registered commands keyed by action ID. */
	commands: Record<string, InternalCommand>
	/** Suspension counter — when > 0, global listener ignores all events. */
	suspendCount: number
	/** Pre-computed signature → action ID lookup. */
	signatureMap: Record<string, string>

	register(entry: CommandEntry): void
	unregister(id: string): void
	suspend(): void
	resume(): void
	/** Returns the effective keybind string for an action (user override or default). */
	resolve(id: string): string
	/** Programmatically fire a command's handler. */
	trigger(id: string): void
}

// ── Store ──────────────────────────────────────────────────────

function buildSignatureMap(commands: Record<string, InternalCommand>): Record<string, string> {
	const overrides = useConfigStore.getState().config.keybindings
	const map: Record<string, string> = {}

	for (const id of Object.keys(commands)) {
		const meta = ACTION_METADATA[id as ActionId]
		// Skip Electron-handled actions only when using the default keybinding.
		// If the user overrode the keybind, Electron's menu accelerator won't
		// fire for the new key, so the DOM listener must handle it.
		if (meta?.electronHandled && !overrides[id]) continue

		const config = overrides[id] ?? DEFAULT_KEYBINDINGS[id as ActionId]
		if (!config || config === "none") continue

		const keybinds = parseKeybind(config)
		for (const kb of keybinds) {
			if (!kb.key) continue
			const sig = signatureFromKeybind(kb)
			// First registration wins on conflict
			if (!(sig in map)) {
				map[sig] = id
			}
		}
	}

	return map
}

export const useKeybindingStore = create<KeybindingState>()(
	immer((set, get) => ({
		commands: {},
		suspendCount: 0,
		signatureMap: {},

		register(entry) {
			set((s) => {
				s.commands[entry.id] = { id: entry.id, handler: entry.handler }
			})
			// Rebuild outside immer (needs config store access)
			const state = get()
			const newMap = buildSignatureMap(state.commands)
			set((s) => {
				s.signatureMap = newMap
			})
		},

		unregister(id) {
			set((s) => {
				delete s.commands[id]
			})
			const state = get()
			const newMap = buildSignatureMap(state.commands)
			set((s) => {
				s.signatureMap = newMap
			})
		},

		suspend() {
			set((s) => {
				s.suspendCount++
			})
		},

		resume() {
			set((s) => {
				s.suspendCount = Math.max(0, s.suspendCount - 1)
			})
		},

		resolve(id) {
			const overrides = useConfigStore.getState().config.keybindings
			return overrides[id] ?? DEFAULT_KEYBINDINGS[id as ActionId] ?? ""
		},

		trigger(id) {
			const cmd = get().commands[id]
			cmd?.handler()
		},
	})),
)

// ── Rebuild signature map when config keybindings change ───────

let prevKeybindings: Record<string, string> = {}

useConfigStore.subscribe((state) => {
	const next = state.config.keybindings
	if (next !== prevKeybindings) {
		prevKeybindings = next
		const store = useKeybindingStore.getState()
		const newMap = buildSignatureMap(store.commands)
		useKeybindingStore.setState({ signatureMap: newMap })
	}
})

// ── Global keydown listener ────────────────────────────────────

function handleGlobalKeyDown(event: KeyboardEvent) {
	const state = useKeybindingStore.getState()

	if (state.suspendCount > 0) return

	const sig = signatureFromEvent(event)
	const actionId = state.signatureMap[sig]
	if (!actionId) return

	const cmd = state.commands[actionId]
	if (!cmd) return

	const meta = ACTION_METADATA[actionId as ActionId]

	// Skip if typing in editable target (unless the action opts out)
	if (!meta?.ignoreEditableCheck && isEditableTarget(event.target)) return

	event.preventDefault()
	cmd.handler()
}

document.addEventListener("keydown", handleGlobalKeyDown)
