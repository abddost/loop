import { getIconForDirectoryPath, getIconForFilePath } from "vscode-material-icons"

// Vite resolves the alias `$material-icons` → node_modules icons dir.
// `?url` returns the hashed asset URL (works in both dev and build).
const iconUrls = import.meta.glob<string>("$material-icons/*.svg", {
	eager: true,
	query: "?url",
	import: "default",
})

// Build a fast lookup: icon name → resolved URL
const iconMap = new Map<string, string>()
for (const [path, url] of Object.entries(iconUrls)) {
	const name = path.split("/").pop()?.replace(".svg", "")
	if (name) iconMap.set(name, url)
}

const fallbackUrl = iconMap.get("document") ?? ""
const fallbackFolderUrl = iconMap.get("folder") ?? ""
const fallbackFolderOpenUrl = iconMap.get("folder-open") ?? ""

/** Resolve a file path to its material icon URL. */
export function getFileIconUrl(filePath: string): string {
	const iconName = getIconForFilePath(filePath)
	return iconMap.get(iconName) ?? fallbackUrl
}

/** Resolve a directory name to its material icon URL. */
export function getDirectoryIconUrl(dirName: string, isOpen = false): string {
	const baseName = getIconForDirectoryPath(dirName)
	if (isOpen) {
		// Try open variant first (e.g. "folder-src-open"), fall back to closed
		return iconMap.get(`${baseName}-open`) ?? iconMap.get(baseName) ?? fallbackFolderOpenUrl
	}
	return iconMap.get(baseName) ?? fallbackFolderUrl
}
