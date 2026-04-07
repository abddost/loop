import { type ActionId, DEFAULT_KEYBINDINGS } from "@core/schema/keybinding"
import { useEffect, useRef } from "react"
import { formatKeybind, formatKeybindParts } from "../lib/keybinding"
import { useConfigStore } from "../stores/config-store"
import { useKeybindingStore } from "../stores/keybinding-store"

// ── useRegisterCommand ─────────────────────────────────────────

interface RegisterCommandOptions {
	id: ActionId
	handler: () => void
}

/**
 * Register a command handler for a keybinding action.
 * Pass `null` to skip registration (e.g. in popout mode).
 * Automatically unregisters on unmount.
 */
export function useRegisterCommand(options: RegisterCommandOptions | null): void {
	const handlerRef = useRef(options?.handler)
	handlerRef.current = options?.handler

	const id = options?.id ?? null

	useEffect(() => {
		if (!id) return

		const store = useKeybindingStore.getState()
		store.register({
			id,
			handler: () => handlerRef.current?.(),
		})

		return () => {
			useKeybindingStore.getState().unregister(id)
		}
	}, [id])
}

// ── useKeybindLabel ────────────────────────────────────────────

/** Returns the formatted keybind string for display (e.g. "⌘B"). */
export function useKeybindLabel(id: ActionId): string {
	const override = useConfigStore((s) => s.config.keybindings[id])
	const config = override ?? DEFAULT_KEYBINDINGS[id] ?? ""
	return formatKeybind(config)
}

// ── useKeybindParts ────────────────────────────────────────────

/** Returns the keybind as individual parts for rendering kbd badges. */
export function useKeybindParts(id: ActionId): string[] {
	const override = useConfigStore((s) => s.config.keybindings[id])
	const config = override ?? DEFAULT_KEYBINDINGS[id] ?? ""
	return formatKeybindParts(config)
}
