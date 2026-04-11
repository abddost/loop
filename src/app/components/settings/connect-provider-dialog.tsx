import type { AuthMethodInfo, AuthPrompt, ProviderInfo } from "@core/schema/provider"
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react"
import { apiClient } from "../../lib/api-client"
import { cn } from "../ui/cn"
import { ProviderIcon } from "../ui/provider-icon"
import {
	ArrowLeftIcon,
	CheckIcon,
	CloseIcon,
	CopyIcon,
	ErrorIcon,
	Spinner,
	formatError,
} from "./shared"

// ─── Types ──────────────────────────────────────────────────────

type Step =
	| "method-select"
	| "prompts"
	| "api-key"
	| "oauth-pending"
	| "oauth-auto"
	| "oauth-code"
	| "error"
	| "complete"

interface ConnectProviderDialogProps {
	provider: ProviderInfo
	open: boolean
	onClose: () => void
	onBack: () => void
	onConnected: () => void
}

// ─── Component ──────────────────────────────────────────────────

export function ConnectProviderDialog({
	provider,
	open,
	onClose,
	onBack,
	onConnected,
}: ConnectProviderDialogProps) {
	const methods = provider.authMethods
	const [selectedMethod, setSelectedMethod] = useState<AuthMethodInfo | null>(null)
	const [step, setStep] = useState<Step>("method-select")
	const [error, setError] = useState<string | undefined>()
	const [promptValues, setPromptValues] = useState<Record<string, string>>({})
	const [authInfo, setAuthInfo] = useState<{
		url?: string
		userCode?: string
		instructions?: string
		method?: string
	} | null>(null)
	const alive = useRef(true)

	const startOAuth = useCallback(
		async (method: AuthMethodInfo, inputs?: Record<string, string>) => {
			setStep("oauth-pending")
			setError(undefined)

			try {
				const result = await apiClient.post<{
					url: string
					userCode: string
					method: string
					instructions: string
				}>(`/providers/${provider.id}/oauth/authorize`, {
					methodId: method.id,
					inputs,
				})

				if (!alive.current) return
				setAuthInfo(result)

				if (result.method === "code") {
					setStep("oauth-code")
				} else {
					setStep("oauth-auto")
					// Poll for completion
					try {
						await apiClient.post(`/providers/${provider.id}/oauth/callback`, {})
						if (!alive.current) return
						setStep("complete")
						onConnected()
					} catch (err) {
						if (!alive.current) return
						setError(formatError(err, "Authorization failed"))
						setStep("error")
					}
				}
			} catch (err) {
				if (!alive.current) return
				setError(formatError(err, "Failed to start authorization"))
				setStep("error")
			}
		},
		[provider.id, onConnected],
	)

	// Reset state when dialog opens/provider changes
	useEffect(() => {
		if (!open) return
		alive.current = true
		setError(undefined)
		setAuthInfo(null)
		setPromptValues({})
		setSelectedMethod(null)

		if (methods.length === 1) {
			const method = methods[0]
			setSelectedMethod(method)
			if (method.type === "oauth" && method.prompts.length === 0) {
				startOAuth(method)
			} else if (method.type === "oauth") {
				setStep("prompts")
			} else {
				setStep("api-key")
			}
		} else {
			setStep("method-select")
		}

		return () => {
			alive.current = false
		}
	}, [open, methods, startOAuth])

	const selectMethod = useCallback(
		(method: AuthMethodInfo) => {
			setSelectedMethod(method)
			if (method.type === "api-key") {
				setStep("api-key")
			} else if (method.prompts.length > 0) {
				setStep("prompts")
			} else {
				startOAuth(method)
			}
		},
		[startOAuth],
	)

	const handlePromptsSubmit = useCallback(
		(values: Record<string, string>) => {
			setPromptValues(values)
			if (selectedMethod) {
				startOAuth(selectedMethod, values)
			}
		},
		[selectedMethod, startOAuth],
	)

	const handleGoBack = useCallback(() => {
		if (step === "method-select" || methods.length <= 1) {
			onBack()
		} else if (step === "prompts") {
			setStep("method-select")
			setSelectedMethod(null)
		} else {
			setStep("method-select")
			setError(undefined)
			setAuthInfo(null)
			setSelectedMethod(null)
		}
	}, [step, methods.length, onBack])

	if (!open) return null

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center">
			{/* Backdrop */}
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss */}
			<div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

			{/* Dialog */}
			<div className="el-dialog relative z-10 w-full max-w-md overflow-hidden bg-background">
				{/* Header with back/close */}
				<div className="flex items-center justify-between px-6 py-4">
					<button
						type="button"
						onClick={handleGoBack}
						className="el-surface-hover rounded-lg p-1.5 text-muted-foreground transition-colors hover:text-foreground"
						aria-label="Go back"
					>
						<ArrowLeftIcon />
					</button>
					<button
						type="button"
						onClick={onClose}
						className="el-surface-hover rounded-lg p-1.5 text-muted-foreground transition-colors hover:text-foreground"
						aria-label="Close"
					>
						<CloseIcon />
					</button>
				</div>

				{/* Provider title */}
				<div className="flex items-center gap-3 px-8 pb-6">
					<ProviderIcon providerId={provider.id} providerName={provider.name} size="md" />
					<h2 className="text-lg font-semibold text-foreground">Connect {provider.name}</h2>
				</div>

				{/* Content */}
				<div className="px-8 pb-8">
					{step === "method-select" && (
						<MethodSelectionView methods={methods} onSelect={selectMethod} />
					)}
					{step === "prompts" && selectedMethod && (
						<PromptsView method={selectedMethod} onSubmit={handlePromptsSubmit} />
					)}
					{step === "api-key" && (
						<ApiKeyView
							provider={provider}
							onComplete={() => {
								onConnected()
								onClose()
							}}
						/>
					)}
					{step === "oauth-pending" && <PendingView />}
					{step === "oauth-auto" && authInfo && (
						<OAuthAutoView authInfo={authInfo} provider={provider} />
					)}
					{step === "oauth-code" && authInfo && (
						<OAuthCodeView
							authInfo={authInfo}
							provider={provider}
							onComplete={() => {
								onConnected()
								onClose()
							}}
							onError={(msg) => {
								setError(msg)
								setStep("error")
							}}
						/>
					)}
					{step === "error" && (
						<ErrorView
							error={error}
							onRetry={() => {
								if (selectedMethod?.type === "oauth") {
									if (selectedMethod.prompts.length > 0) {
										startOAuth(selectedMethod, promptValues)
									} else {
										startOAuth(selectedMethod)
									}
								} else {
									setStep("api-key")
								}
							}}
						/>
					)}
					{step === "complete" && <CompleteView providerName={provider.name} onClose={onClose} />}
				</div>
			</div>
		</div>
	)
}

// ─── Method Selection ───────────────────────────────────────────

function MethodSelectionView({
	methods,
	onSelect,
}: {
	methods: AuthMethodInfo[]
	onSelect: (method: AuthMethodInfo) => void
}) {
	return (
		<div>
			<p className="mb-5 text-sm text-muted-foreground">Choose how to connect.</p>
			<div className="flex flex-col gap-2">
				{methods.map((method) => (
					<button
						key={method.id}
						type="button"
						onClick={() => onSelect(method)}
						className="el-surface-hover flex w-full items-start gap-3 rounded-xl border border-border px-4 py-3.5 text-left transition-colors"
					>
						<span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-muted-foreground/40" />
						<div className="min-w-0 flex-1">
							<span className="text-sm font-medium text-foreground">{method.label}</span>
							{method.description && (
								<p className="mt-0.5 text-xs text-muted">{method.description}</p>
							)}
						</div>
					</button>
				))}
			</div>
		</div>
	)
}

// ─── Prompts View ───────────────────────────────────────────────

function PromptsView({
	method,
	onSubmit,
}: {
	method: AuthMethodInfo
	onSubmit: (values: Record<string, string>) => void
}) {
	const [values, setValues] = useState<Record<string, string>>({})

	const visiblePrompts = method.prompts.filter((p) => {
		if (!p.when) return true
		const { key, op, value } = p.when
		const current = values[key]
		return op === "eq" ? current === value : current !== value
	})

	const handleSubmit = (e: FormEvent) => {
		e.preventDefault()
		onSubmit(values)
	}

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-5">
			{visiblePrompts.map((prompt) => (
				<PromptField
					key={prompt.key}
					prompt={prompt}
					value={values[prompt.key] ?? ""}
					onChange={(val) => setValues((prev) => ({ ...prev, [prompt.key]: val }))}
				/>
			))}
			<button
				type="submit"
				className="el-btn-pill self-start bg-accent px-5 py-2 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90"
			>
				Continue
			</button>
		</form>
	)
}

function PromptField({
	prompt,
	value,
	onChange,
}: {
	prompt: AuthPrompt
	value: string
	onChange: (value: string) => void
}) {
	if (prompt.type === "select" && prompt.options) {
		return (
			<div>
				<span className="mb-2 block text-xs font-medium text-muted-foreground">{prompt.label}</span>
				<div className="flex flex-col gap-1.5">
					{prompt.options.map((opt) => (
						<button
							key={opt.value}
							type="button"
							onClick={() => onChange(opt.value)}
							className={cn(
								"flex items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors",
								value === opt.value
									? "border-accent bg-accent/10 text-foreground"
									: "border-border text-foreground hover:bg-surface-hover",
							)}
						>
							<span
								className={cn(
									"flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2",
									value === opt.value ? "border-accent" : "border-muted-foreground/40",
								)}
							>
								{value === opt.value && <span className="h-2 w-2 rounded-full bg-accent" />}
							</span>
							<span>{opt.label}</span>
							{opt.hint && <span className="ml-auto text-xs text-muted">{opt.hint}</span>}
						</button>
					))}
				</div>
			</div>
		)
	}

	return (
		<div>
			<span className="mb-2 block text-xs font-medium text-muted-foreground">{prompt.label}</span>
			<input
				type="text"
				placeholder={prompt.placeholder}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				className="block w-full rounded-lg bg-surface px-3 py-2.5 text-sm text-foreground placeholder:text-placeholder shadow-[var(--shadow-inset)] outline-none transition-colors focus:border-accent"
			/>
		</div>
	)
}

// ─── API Key Form ───────────────────────────────────────────────

function ApiKeyView({
	provider,
	onComplete,
}: {
	provider: ProviderInfo
	onComplete: () => void
}) {
	const [key, setKey] = useState("")
	const [error, setError] = useState<string | undefined>()
	const [saving, setSaving] = useState(false)

	const envHint = provider.envKeys[0]

	const handleSubmit = useCallback(
		async (e: FormEvent) => {
			e.preventDefault()
			const trimmed = key.trim()
			if (!trimmed) {
				setError("API key is required")
				return
			}

			setSaving(true)
			setError(undefined)

			try {
				await apiClient.put(`/providers/${provider.id}`, { apiKey: trimmed })
				onComplete()
			} catch (err) {
				setError(formatError(err, "Failed to save API key"))
				setSaving(false)
			}
		},
		[key, provider.id, onComplete],
	)

	return (
		<div>
			<p className="mb-5 text-sm text-muted-foreground">
				Enter your API key for {provider.name}.
				{envHint && (
					<>
						{" "}
						You can also set the{" "}
						<code className="rounded bg-code-inline px-1.5 py-0.5 font-mono text-xs">
							{envHint}
						</code>{" "}
						environment variable.
					</>
				)}
			</p>
			<form onSubmit={handleSubmit} className="flex flex-col gap-4">
				<div>
					<input
						type="password"
						placeholder="API key"
						value={key}
						onChange={(e) => {
							setKey(e.target.value)
							setError(undefined)
						}}
						className={cn(
							"block w-full rounded-lg border bg-surface px-3 py-2.5 text-sm text-foreground placeholder:text-placeholder outline-none transition-colors focus:border-accent",
							error ? "border-danger" : "border-border",
						)}
						// biome-ignore lint/a11y/noAutofocus: dialog input should auto-focus
						autoFocus
					/>
					{error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
				</div>
				<button
					type="submit"
					disabled={saving || !key.trim()}
					className={cn(
						"el-btn-pill self-start px-5 py-2 text-sm font-medium transition-colors",
						saving || !key.trim()
							? "cursor-not-allowed bg-accent/40 text-accent-foreground/60"
							: "bg-accent text-accent-foreground hover:bg-accent/90",
					)}
				>
					{saving ? "Connecting..." : "Continue"}
				</button>
			</form>
		</div>
	)
}

// ─── OAuth Auto View ────────────────────────────────────────────

function OAuthAutoView({
	authInfo,
	provider,
}: {
	authInfo: { url?: string; instructions?: string; userCode?: string }
	provider: ProviderInfo
}) {
	const code = authInfo.instructions?.includes(":")
		? authInfo.instructions.split(":")[1]?.trim()
		: authInfo.userCode || authInfo.instructions

	return (
		<div className="flex flex-col gap-5">
			{code ? (
				<>
					<p className="text-sm text-foreground">
						Visit{" "}
						{authInfo.url ? (
							<a
								href={authInfo.url}
								target="_blank"
								rel="noopener noreferrer"
								className="font-medium text-accent underline underline-offset-2 hover:text-accent/80"
							>
								this link
							</a>
						) : (
							"the authorization page"
						)}{" "}
						and enter the code below to connect {provider.name}.
					</p>
					<div>
						<span className="mb-2 block text-xs font-medium text-muted-foreground">
							Confirmation code
						</span>
						<div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-3">
							<code className="flex-1 font-mono text-base font-semibold tracking-wider text-foreground">
								{code}
							</code>
							<button
								type="button"
								onClick={() => navigator.clipboard.writeText(code)}
								className="el-surface-hover shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
								aria-label="Copy code"
							>
								<CopyIcon />
							</button>
						</div>
					</div>
				</>
			) : (
				<p className="text-sm text-foreground">
					{authInfo.url ? (
						<>
							Opening{" "}
							<a
								href={authInfo.url}
								target="_blank"
								rel="noopener noreferrer"
								className="font-medium text-accent underline underline-offset-2 hover:text-accent/80"
							>
								authorization page
							</a>{" "}
							in your browser...
						</>
					) : (
						"Completing authorization..."
					)}
				</p>
			)}
			<div className="flex items-center gap-3 text-sm text-muted-foreground">
				<Spinner />
				<span>Waiting for authorization...</span>
			</div>
		</div>
	)
}

// ─── OAuth Code View ────────────────────────────────────────────

function OAuthCodeView({
	authInfo,
	provider,
	onComplete,
	onError,
}: {
	authInfo: { url?: string; instructions?: string }
	provider: ProviderInfo
	onComplete: () => void
	onError: (msg: string) => void
}) {
	const [code, setCode] = useState("")
	const [submitting, setSubmitting] = useState(false)

	const handleSubmit = useCallback(
		async (e: FormEvent) => {
			e.preventDefault()
			if (!code.trim()) return

			setSubmitting(true)
			try {
				await apiClient.post(`/providers/${provider.id}/oauth/callback`, { code: code.trim() })
				onComplete()
			} catch (err) {
				onError(formatError(err, "Authorization code was invalid"))
			} finally {
				setSubmitting(false)
			}
		},
		[code, provider.id, onComplete, onError],
	)

	return (
		<div className="flex flex-col gap-5">
			<p className="text-sm text-foreground">
				Visit{" "}
				{authInfo.url ? (
					<a
						href={authInfo.url}
						target="_blank"
						rel="noopener noreferrer"
						className="font-medium text-accent underline underline-offset-2 hover:text-accent/80"
					>
						this link
					</a>
				) : (
					"the authorization page"
				)}{" "}
				and paste the code below to connect your {provider.name} account.
			</p>
			<form onSubmit={handleSubmit} className="flex flex-col gap-4">
				<div>
					<span className="mb-2 block text-xs font-medium text-muted-foreground">
						Authorization code
					</span>
					<input
						type="text"
						placeholder="Paste code here"
						value={code}
						onChange={(e) => setCode(e.target.value)}
						className="block w-full rounded-lg bg-surface px-3 py-2.5 text-sm text-foreground placeholder:text-placeholder shadow-[var(--shadow-inset)] outline-none transition-colors focus:border-accent"
						// biome-ignore lint/a11y/noAutofocus: dialog input should auto-focus
						autoFocus
					/>
				</div>
				<button
					type="submit"
					disabled={submitting || !code.trim()}
					className={cn(
						"el-btn-pill self-start px-5 py-2 text-sm font-medium transition-colors",
						submitting || !code.trim()
							? "cursor-not-allowed bg-accent/40 text-accent-foreground/60"
							: "bg-accent text-accent-foreground hover:bg-accent/90",
					)}
				>
					{submitting ? "Verifying..." : "Continue"}
				</button>
			</form>
		</div>
	)
}

// ─── Pending / Error / Complete ─────────────────────────────────

function PendingView() {
	return (
		<div className="flex items-center gap-3 py-4 text-sm text-muted-foreground">
			<Spinner />
			<span>Connecting...</span>
		</div>
	)
}

function ErrorView({ error, onRetry }: { error?: string; onRetry: () => void }) {
	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-start gap-2.5 rounded-lg border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
				<ErrorIcon />
				<span>{error ?? "Connection failed"}</span>
			</div>
			<button
				type="button"
				onClick={onRetry}
				className="el-btn-pill self-start !bg-transparent px-4 py-2 text-sm font-medium text-foreground shadow-[var(--shadow-inset)] transition-colors hover:bg-surface-hover"
			>
				Try again
			</button>
		</div>
	)
}

function CompleteView({ providerName, onClose }: { providerName: string; onClose: () => void }) {
	return (
		<div className="flex flex-col items-center gap-4 py-6 text-center">
			<div className="flex h-12 w-12 items-center justify-center rounded-full bg-success/15">
				<CheckIcon />
			</div>
			<p className="text-sm font-medium text-foreground">{providerName} connected successfully</p>
			<button
				type="button"
				onClick={onClose}
				className="el-btn-pill mt-1 bg-accent px-6 py-2 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90"
			>
				Done
			</button>
		</div>
	)
}
