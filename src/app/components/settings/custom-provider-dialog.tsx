import { type FormEvent, useCallback, useId, useMemo, useState } from "react"
import { apiClient } from "../../lib/api-client"
import { cn } from "../ui/cn"

// ─── Types ───────────────────────────────────────────────────

interface ModelRow {
	key: string
	id: string
	name: string
}

interface HeaderRow {
	key: string
	headerKey: string
	headerValue: string
}

interface FormErrors {
	providerId?: string
	name?: string
	baseUrl?: string
	models?: Record<string, { id?: string; name?: string }>
	headers?: Record<string, { key?: string; value?: string }>
}

interface CustomProviderDialogProps {
	open: boolean
	onClose: () => void
	onSaved: () => void
	existingProviderIds?: Set<string>
}

// ─── Validation ──────────────────────────────────────────────

const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/

function validate(
	providerId: string,
	name: string,
	baseUrl: string,
	models: ModelRow[],
	headers: HeaderRow[],
	existingIds: Set<string>,
): { errors: FormErrors; valid: boolean } {
	const errors: FormErrors = {}
	let valid = true

	// Provider ID
	const trimmedId = providerId.trim()
	if (!trimmedId) {
		errors.providerId = "Provider ID is required"
		valid = false
	} else if (!PROVIDER_ID_PATTERN.test(trimmedId)) {
		errors.providerId = "Lowercase alphanumeric, dashes, and underscores only"
		valid = false
	} else if (existingIds.has(trimmedId)) {
		errors.providerId = "A provider with this ID already exists"
		valid = false
	}

	// Name
	if (!name.trim()) {
		errors.name = "Display name is required"
		valid = false
	}

	// Base URL
	const trimmedUrl = baseUrl.trim()
	if (!trimmedUrl) {
		errors.baseUrl = "Base URL is required"
		valid = false
	} else if (!/^https?:\/\//.test(trimmedUrl)) {
		errors.baseUrl = "Must start with http:// or https://"
		valid = false
	}

	// Models — at least one required
	const modelErrors: Record<string, { id?: string; name?: string }> = {}
	const seenModelIds = new Set<string>()
	let hasModelError = false

	if (models.length === 0 || models.every((m) => !m.id.trim() && !m.name.trim())) {
		// No models at all
		modelErrors[models[0]?.key ?? ""] = { id: "At least one model is required" }
		hasModelError = true
	} else {
		for (const m of models) {
			const mId = m.id.trim()
			const mName = m.name.trim()
			const errs: { id?: string; name?: string } = {}

			if (!mId && !mName) continue // skip empty rows

			if (!mId) {
				errs.id = "Required"
				hasModelError = true
			} else if (seenModelIds.has(mId)) {
				errs.id = "Duplicate"
				hasModelError = true
			} else {
				seenModelIds.add(mId)
			}

			if (!mName) {
				errs.name = "Required"
				hasModelError = true
			}

			if (errs.id || errs.name) {
				modelErrors[m.key] = errs
			}
		}
	}

	if (hasModelError) {
		errors.models = modelErrors
		valid = false
	}

	// Headers (optional, but if partially filled, both key and value required)
	const headerErrors: Record<string, { key?: string; value?: string }> = {}
	const seenHeaderKeys = new Set<string>()
	let hasHeaderError = false

	for (const h of headers) {
		const hk = h.headerKey.trim()
		const hv = h.headerValue.trim()
		if (!hk && !hv) continue
		const errs: { key?: string; value?: string } = {}

		if (!hk) {
			errs.key = "Required"
			hasHeaderError = true
		} else if (seenHeaderKeys.has(hk.toLowerCase())) {
			errs.key = "Duplicate"
			hasHeaderError = true
		} else {
			seenHeaderKeys.add(hk.toLowerCase())
		}

		if (!hv) {
			errs.value = "Required"
			hasHeaderError = true
		}

		if (errs.key || errs.value) {
			headerErrors[h.key] = errs
		}
	}

	if (hasHeaderError) {
		errors.headers = headerErrors
		valid = false
	}

	return { errors, valid }
}

// ─── Component ───────────────────────────────────────────────

let rowCounter = 0
function nextKey() {
	return `row-${rowCounter++}`
}

export function CustomProviderDialog({
	open,
	onClose,
	onSaved,
	existingProviderIds = new Set(),
}: CustomProviderDialogProps) {
	const formId = useId()
	const [providerId, setProviderId] = useState("")
	const [name, setName] = useState("")
	const [baseUrl, setBaseUrl] = useState("")
	const [apiKey, setApiKey] = useState("")
	const [models, setModels] = useState<ModelRow[]>([{ key: nextKey(), id: "", name: "" }])
	const [headers, setHeaders] = useState<HeaderRow[]>([
		{ key: nextKey(), headerKey: "", headerValue: "" },
	])
	const [errors, setErrors] = useState<FormErrors>({})
	const [saving, setSaving] = useState(false)

	const resetForm = useCallback(() => {
		setProviderId("")
		setName("")
		setBaseUrl("")
		setApiKey("")
		setModels([{ key: nextKey(), id: "", name: "" }])
		setHeaders([{ key: nextKey(), headerKey: "", headerValue: "" }])
		setErrors({})
		setSaving(false)
	}, [])

	const handleClose = useCallback(() => {
		resetForm()
		onClose()
	}, [resetForm, onClose])

	// Model row operations
	const addModel = useCallback(() => {
		setModels((prev) => [...prev, { key: nextKey(), id: "", name: "" }])
	}, [])

	const removeModel = useCallback(
		(rowKey: string) => {
			if (models.length <= 1) return
			setModels((prev) => prev.filter((m) => m.key !== rowKey))
		},
		[models.length],
	)

	const updateModel = useCallback((rowKey: string, field: "id" | "name", value: string) => {
		setModels((prev) => prev.map((m) => (m.key === rowKey ? { ...m, [field]: value } : m)))
		setErrors((prev) => {
			if (!prev.models?.[rowKey]) return prev
			const updated = { ...prev.models }
			delete updated[rowKey]
			return { ...prev, models: Object.keys(updated).length ? updated : undefined }
		})
	}, [])

	// Header row operations
	const addHeader = useCallback(() => {
		setHeaders((prev) => [...prev, { key: nextKey(), headerKey: "", headerValue: "" }])
	}, [])

	const removeHeader = useCallback(
		(rowKey: string) => {
			if (headers.length <= 1) return
			setHeaders((prev) => prev.filter((h) => h.key !== rowKey))
		},
		[headers.length],
	)

	const updateHeader = useCallback(
		(rowKey: string, field: "headerKey" | "headerValue", value: string) => {
			setHeaders((prev) => prev.map((h) => (h.key === rowKey ? { ...h, [field]: value } : h)))
			setErrors((prev) => {
				if (!prev.headers?.[rowKey]) return prev
				const updated = { ...prev.headers }
				delete updated[rowKey]
				return { ...prev, headers: Object.keys(updated).length ? updated : undefined }
			})
		},
		[],
	)

	// Build the model and header config to send to the server
	const buildPayload = useMemo(() => {
		return () => {
			const modelList = models
				.filter((m) => m.id.trim() && m.name.trim())
				.map((m) => ({
					id: m.id.trim(),
					name: m.name.trim(),
				}))

			const headerMap: Record<string, string> = {}
			for (const h of headers) {
				const k = h.headerKey.trim()
				const v = h.headerValue.trim()
				if (k && v) headerMap[k] = v
			}

			return {
				name: name.trim(),
				baseUrl: baseUrl.trim(),
				apiKey: apiKey.trim() || undefined,
				models: modelList,
				headers: Object.keys(headerMap).length ? headerMap : undefined,
			}
		}
	}, [name, baseUrl, apiKey, models, headers])

	const handleSubmit = useCallback(
		async (e: FormEvent) => {
			e.preventDefault()
			if (saving) return

			const { errors: errs, valid } = validate(
				providerId,
				name,
				baseUrl,
				models,
				headers,
				existingProviderIds,
			)
			setErrors(errs)
			if (!valid) return

			setSaving(true)

			try {
				const payload = buildPayload()
				// Save the custom provider via config PATCH
				await apiClient.patch("/config", {
					customProviders: {
						[providerId.trim()]: payload,
					},
				})

				// If an API key was provided, save it separately
				if (payload.apiKey) {
					await apiClient.put(`/providers/${providerId.trim()}`, {
						apiKey: payload.apiKey,
						baseUrl: payload.baseUrl,
					})
				}

				resetForm()
				onSaved()
				onClose()
			} catch (err) {
				console.error("[custom-provider:save]", err)
				setSaving(false)
			}
		},
		[
			saving,
			providerId,
			name,
			baseUrl,
			models,
			headers,
			existingProviderIds,
			buildPayload,
			resetForm,
			onSaved,
			onClose,
		],
	)

	if (!open) return null

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center">
			{/* Backdrop */}
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss is a convenience, keyboard users use the close button */}
			<div className="absolute inset-0 bg-black/50" onClick={handleClose} />

			{/* Dialog */}
			<div className="relative z-10 w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-xl border border-border bg-background shadow-2xl">
				{/* Header */}
				<div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background px-6 py-4">
					<h2 className="text-base font-semibold text-foreground">Add Custom Provider</h2>
					<button
						type="button"
						onClick={handleClose}
						className="text-muted-foreground transition-colors hover:text-foreground"
						aria-label="Close"
					>
						<svg
							className="h-4 w-4"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							strokeWidth={2}
							aria-hidden="true"
						>
							<title>Close</title>
							<path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>

				{/* Form */}
				<form id={formId} onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
					<p className="text-xs text-muted">
						Add an OpenAI-compatible provider. You can use any API that follows the OpenAI chat
						completions format.
					</p>

					{/* Provider ID */}
					<FieldGroup
						label="Provider ID"
						error={errors.providerId}
						hint="Lowercase alphanumeric with dashes/underscores"
					>
						<input
							type="text"
							placeholder="my-provider"
							value={providerId}
							onChange={(e) => {
								setProviderId(e.target.value)
								setErrors((prev) => ({ ...prev, providerId: undefined }))
							}}
							className={fieldClasses(!!errors.providerId)}
						/>
					</FieldGroup>

					{/* Display Name */}
					<FieldGroup label="Display Name" error={errors.name}>
						<input
							type="text"
							placeholder="My Provider"
							value={name}
							onChange={(e) => {
								setName(e.target.value)
								setErrors((prev) => ({ ...prev, name: undefined }))
							}}
							className={fieldClasses(!!errors.name)}
						/>
					</FieldGroup>

					{/* Base URL */}
					<FieldGroup label="Base URL" error={errors.baseUrl}>
						<input
							type="text"
							placeholder="https://api.example.com/v1"
							value={baseUrl}
							onChange={(e) => {
								setBaseUrl(e.target.value)
								setErrors((prev) => ({ ...prev, baseUrl: undefined }))
							}}
							className={fieldClasses(!!errors.baseUrl)}
						/>
					</FieldGroup>

					{/* API Key (optional) */}
					<FieldGroup
						label="API Key"
						hint="Optional. Use {env:VAR_NAME} to reference an environment variable."
					>
						<input
							type="password"
							placeholder="sk-... or {env:MY_API_KEY}"
							value={apiKey}
							onChange={(e) => setApiKey(e.target.value)}
							className={fieldClasses(false)}
						/>
					</FieldGroup>

					{/* Models */}
					<div>
						<span className="mb-2 block text-xs font-medium text-muted-foreground">Models</span>
						<div className="space-y-2">
							{models.map((m) => (
								<div key={m.key} className="flex items-start gap-2">
									<div className="flex-1">
										<input
											type="text"
											placeholder="Model ID (e.g. gpt-4o)"
											value={m.id}
											onChange={(e) => updateModel(m.key, "id", e.target.value)}
											className={fieldClasses(!!errors.models?.[m.key]?.id)}
										/>
										{errors.models?.[m.key]?.id && (
											<p className="mt-0.5 text-[10px] text-danger">{errors.models[m.key].id}</p>
										)}
									</div>
									<div className="flex-1">
										<input
											type="text"
											placeholder="Display name"
											value={m.name}
											onChange={(e) => updateModel(m.key, "name", e.target.value)}
											className={fieldClasses(!!errors.models?.[m.key]?.name)}
										/>
										{errors.models?.[m.key]?.name && (
											<p className="mt-0.5 text-[10px] text-danger">{errors.models[m.key].name}</p>
										)}
									</div>
									<button
										type="button"
										onClick={() => removeModel(m.key)}
										disabled={models.length <= 1}
										className="mt-2 text-muted-foreground transition-colors hover:text-danger disabled:opacity-30"
										aria-label="Remove model"
									>
										<TrashIcon />
									</button>
								</div>
							))}
						</div>
						<button
							type="button"
							onClick={addModel}
							className="mt-2 text-xs text-accent transition-colors hover:text-accent/80"
						>
							+ Add model
						</button>
					</div>

					{/* Custom Headers */}
					<div>
						<span className="mb-2 block text-xs font-medium text-muted-foreground">
							Custom Headers <span className="font-normal text-muted">(optional)</span>
						</span>
						<div className="space-y-2">
							{headers.map((h) => (
								<div key={h.key} className="flex items-start gap-2">
									<div className="flex-1">
										<input
											type="text"
											placeholder="Header name"
											value={h.headerKey}
											onChange={(e) => updateHeader(h.key, "headerKey", e.target.value)}
											className={fieldClasses(!!errors.headers?.[h.key]?.key)}
										/>
										{errors.headers?.[h.key]?.key && (
											<p className="mt-0.5 text-[10px] text-danger">{errors.headers[h.key].key}</p>
										)}
									</div>
									<div className="flex-1">
										<input
											type="text"
											placeholder="Value"
											value={h.headerValue}
											onChange={(e) => updateHeader(h.key, "headerValue", e.target.value)}
											className={fieldClasses(!!errors.headers?.[h.key]?.value)}
										/>
										{errors.headers?.[h.key]?.value && (
											<p className="mt-0.5 text-[10px] text-danger">
												{errors.headers[h.key].value}
											</p>
										)}
									</div>
									<button
										type="button"
										onClick={() => removeHeader(h.key)}
										disabled={headers.length <= 1}
										className="mt-2 text-muted-foreground transition-colors hover:text-danger disabled:opacity-30"
										aria-label="Remove header"
									>
										<TrashIcon />
									</button>
								</div>
							))}
						</div>
						<button
							type="button"
							onClick={addHeader}
							className="mt-2 text-xs text-accent transition-colors hover:text-accent/80"
						>
							+ Add header
						</button>
					</div>
				</form>

				{/* Footer */}
				<div className="sticky bottom-0 flex justify-end gap-3 border-t border-border bg-background px-6 py-4">
					<button
						type="button"
						onClick={handleClose}
						className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
					>
						Cancel
					</button>
					<button
						type="submit"
						form={formId}
						disabled={saving}
						className={cn(
							"rounded-lg px-4 py-2 text-sm font-medium transition-colors",
							saving
								? "cursor-not-allowed bg-accent/40 text-accent-foreground/60"
								: "bg-accent text-accent-foreground hover:bg-accent/90",
						)}
					>
						{saving ? "Saving..." : "Add Provider"}
					</button>
				</div>
			</div>
		</div>
	)
}

// ─── Shared UI pieces ────────────────────────────────────────

function FieldGroup({
	label,
	error,
	hint,
	children,
}: {
	label: string
	error?: string
	hint?: string
	children: React.ReactNode
}) {
	return (
		<div>
			{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps the input via children */}
			<label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
			{children}
			{hint && !error && <p className="mt-0.5 text-[10px] text-muted">{hint}</p>}
			{error && <p className="mt-0.5 text-[10px] text-danger">{error}</p>}
		</div>
	)
}

function fieldClasses(hasError: boolean) {
	return cn(
		"block w-full rounded-lg border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-placeholder outline-none transition-colors focus:border-accent",
		hasError ? "border-danger" : "border-border",
	)
}

function TrashIcon() {
	return (
		<svg
			className="h-3.5 w-3.5"
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			strokeWidth={1.5}
			aria-hidden="true"
		>
			<title>Remove</title>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
			/>
		</svg>
	)
}
