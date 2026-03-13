import { useCallback, useState } from "react"
import { apiClient } from "../lib/api-client"

export function useApi() {
	return { apiClient }
}

export function useApiMutation<T>(fn: () => Promise<T>) {
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<Error | null>(null)

	const mutate = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			const result = await fn()
			return result
		} catch (e) {
			setError(e as Error)
			throw e
		} finally {
			setLoading(false)
		}
	}, [fn])

	return { mutate, loading, error }
}
