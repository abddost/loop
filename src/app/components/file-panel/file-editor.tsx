import { Suspense, lazy, useCallback } from "react"
import {
	selectActiveFileUri,
	selectOpenFiles,
	useFilePanelStore,
} from "../../stores/file-panel-store"
import type { CursorInfo } from "./codemirror-viewer"
import { ConflictBanner } from "./conflict-banner"

// File viewer is CodeMirror 6 by default. To fall back to the Monaco
// implementation, run in devtools: localStorage.setItem("loop:file-viewer", "monaco")
// and reload. Read once at module load — switching requires a full reload.
const useMonacoViewer =
	typeof window !== "undefined" && window.localStorage?.getItem("loop:file-viewer") === "monaco"

const FileViewer = lazy(() =>
	useMonacoViewer ? import("./monaco-editor-wrapper") : import("./codemirror-viewer"),
)

interface FileEditorProps {
	onCursorChange?: (info: CursorInfo) => void
}

export function FileEditor({ onCursorChange }: FileEditorProps = {}) {
	const activeUri = useFilePanelStore(selectActiveFileUri)
	const openFiles = useFilePanelStore(selectOpenFiles)
	const setFileContent = useFilePanelStore((s) => s.setFileContent)
	const saveFile = useFilePanelStore((s) => s.saveFile)

	const activeFile = openFiles.find((f) => f.uri === activeUri)

	const handleContentChange = useCallback(
		(content: string) => {
			if (activeFile) setFileContent(activeFile.uri, content)
		},
		[activeFile, setFileContent],
	)

	const handleSave = useCallback(() => {
		if (activeFile) {
			saveFile(activeFile.uri).catch((err) => console.error("[file-editor] save failed:", err))
		}
	}, [activeFile, saveFile])

	if (!activeFile) {
		return (
			<div className="flex h-full items-center justify-center">
				<p className="text-xs text-muted">Open a file to view its contents</p>
			</div>
		)
	}

	if (activeFile.binary) {
		return (
			<div className="flex h-full items-center justify-center">
				<p className="text-xs text-muted">Binary file &mdash; cannot display</p>
			</div>
		)
	}

	if (activeFile.content === null) {
		return (
			<div className="flex h-full items-center justify-center">
				<p className="text-xs text-muted">Loading...</p>
			</div>
		)
	}

	return (
		<div className="flex h-full flex-col">
			{activeFile.diskConflict && <ConflictBanner uri={activeFile.uri} />}
			<div className="min-h-0 flex-1">
				<Suspense
					fallback={
						<div className="flex h-full items-center justify-center">
							<p className="text-xs text-muted">Loading editor...</p>
						</div>
					}
				>
					<FileViewer
						content={activeFile.content}
						language={activeFile.language}
						path={activeFile.path}
						readOnly={activeFile.binary}
						onCursorChange={onCursorChange}
						onContentChange={handleContentChange}
						onSave={handleSave}
					/>
				</Suspense>
			</div>
		</div>
	)
}
