export class ApiClient {
	private baseUrl = ""
	private token = ""
	private currentDirectory: string | undefined

	/** Initialize with server URL and auth token */
	init(url: string, token: string): void {
		this.baseUrl = url.replace(/\/$/, "")
		this.token = token
	}

	/** Set the current workspace directory for subsequent requests */
	setWorkspaceDirectory(directory: string): void {
		this.currentDirectory = directory
	}

	/** GET request with automatic JSON parsing */
	async get<T>(
		path: string,
		opts?: {
			directory?: string
			signal?: AbortSignal
		},
	): Promise<T> {
		return this.request<T>("GET", path, { ...opts })
	}

	/** POST request */
	async post<T>(
		path: string,
		body?: unknown,
		opts?: {
			directory?: string
			signal?: AbortSignal
		},
	): Promise<T> {
		return this.request<T>("POST", path, { ...opts, body })
	}

	/** PUT request */
	async put<T>(
		path: string,
		body?: unknown,
		opts?: {
			directory?: string
			signal?: AbortSignal
		},
	): Promise<T> {
		return this.request<T>("PUT", path, { ...opts, body })
	}

	/** PATCH request */
	async patch<T>(
		path: string,
		body?: unknown,
		opts?: {
			directory?: string
		},
	): Promise<T> {
		return this.request<T>("PATCH", path, { ...opts, body })
	}

	/** DELETE request */
	async del(path: string, opts?: { directory?: string }): Promise<void> {
		await this.request<void>("DELETE", path, { ...opts })
	}

	private async request<T>(
		method: string,
		path: string,
		opts: {
			directory?: string
			body?: unknown
			signal?: AbortSignal
		} = {},
	): Promise<T> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		}

		if (this.token) {
			headers.Authorization = `Basic ${btoa(`:${this.token}`)}`
		}

		const dir = opts.directory ?? this.currentDirectory
		if (dir) {
			headers["x-workspace-directory"] = dir
		}

		const res = await fetch(`${this.baseUrl}${path}`, {
			method,
			headers,
			body: opts.body ? JSON.stringify(opts.body) : undefined,
			signal: opts.signal,
		})

		if (!res.ok) {
			const text = await res.text().catch(() => "Unknown error")
			throw new ApiError(res.status, text, path)
		}

		if (res.status === 204 || res.headers.get("content-length") === "0") {
			return undefined as T
		}

		return res.json() as Promise<T>
	}
}

export class ApiError extends Error {
	constructor(
		public readonly status: number,
		public readonly body: string,
		public readonly path: string,
	) {
		super(`API ${status}: ${body} (${path})`)
		this.name = "ApiError"
	}
}

export const apiClient = new ApiClient()
