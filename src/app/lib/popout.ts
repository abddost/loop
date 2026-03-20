/**
 * Popout window detection.
 *
 * Reads from the desktop bridge once at module load.
 * Provides a cheap synchronous check for all components.
 */

import { desktopBridge } from "./desktop-bridge"

const IS_POPOUT = desktopBridge.isPopout()
const POPOUT_CONTEXT = desktopBridge.getPopoutContext()

/** Whether this renderer is a popout window. */
export function isPopoutWindow(): boolean {
	return IS_POPOUT
}

/** Get the popout context (sessionId, directory, title). Null in main window. */
export function getPopoutContext() {
	return POPOUT_CONTEXT
}
