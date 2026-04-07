import { create } from "zustand"

// ── Types ──────────────────────────────────────────────────────

export type SnackbarVariant = "error" | "success" | "info"

export interface SnackbarItem {
	id: string
	message: string
	variant: SnackbarVariant
	/** Auto-dismiss delay in ms. 0 = manual dismiss only. */
	duration: number
}

interface SnackbarState {
	items: SnackbarItem[]
	push(message: string, variant?: SnackbarVariant, duration?: number): void
	dismiss(id: string): void
}

// ── Store ──────────────────────────────────────────────────────

let nextId = 0

export const useSnackbarStore = create<SnackbarState>()((set) => ({
	items: [],

	push(message, variant = "error", duration = 5000) {
		const id = `snack-${++nextId}`
		set((s) => ({ items: [...s.items, { id, message, variant, duration }] }))

		if (duration > 0) {
			setTimeout(() => {
				set((s) => ({ items: s.items.filter((i) => i.id !== id) }))
			}, duration)
		}
	},

	dismiss(id) {
		set((s) => ({ items: s.items.filter((i) => i.id !== id) }))
	},
}))
