import { create } from "zustand"
import { getPinnedSessionIds, setPinnedSessionIds } from "../lib/local-persistence"

interface PinState {
	pinnedIds: Set<string>
	togglePin(sessionId: string): void
}

export const usePinStore = create<PinState>()((set) => ({
	pinnedIds: new Set(getPinnedSessionIds()),

	togglePin(sessionId) {
		set((s) => {
			const next = new Set(s.pinnedIds)
			if (next.has(sessionId)) {
				next.delete(sessionId)
			} else {
				next.add(sessionId)
			}
			setPinnedSessionIds([...next])
			return { pinnedIds: next }
		})
	},
}))
