/**
 * Platform detection for the renderer.
 *
 * Used to gate macOS-specific UI affordances — chiefly the left gutter
 * reserved for the traffic-light window controls, which only exist on
 * macOS. Linux and Windows draw the window controls on the right (or in
 * their own native chrome), so the gutter shows up as dead space.
 *
 * Cached at module load: the Electron renderer is restarted, not
 * migrated between OSes mid-run, so a single read is sufficient.
 */
export const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent)

/**
 * Left padding inside titlebars to clear the macOS traffic lights.
 * 0 elsewhere — frameless windows on Linux/Windows have no overlap.
 */
export const TRAFFIC_LIGHT_GUTTER_PX = isMac ? 72 : 0
