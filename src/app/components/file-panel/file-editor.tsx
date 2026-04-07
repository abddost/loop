import { Suspense, lazy } from "react"
import {
	selectActiveFileUri,
	selectOpenFiles,
	useFilePanelStore,
} from "../../stores/file-panel-store"

const MonacoEditorWrapper = lazy(() => import("./monaco-editor-wrapper"))

export function FileEditor() {
	const activeUri = useFilePanelStore(selectActiveFileUri)
	const openFiles = useFilePanelStore(selectOpenFiles)

	const activeFile = openFiles.find((f) => f.uri === activeUri)

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
		<Suspense
			fallback={
				<div className="flex h-full items-center justify-center">
					<p className="text-xs text-muted">Loading editor...</p>
				</div>
			}
		>
			<MonacoEditorWrapper
				content={activeFile.content}
				language={activeFile.language}
				path={activeFile.path}
			/>
		</Suspense>
	)
}
