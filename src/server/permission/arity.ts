/**
 * Bash command arity dictionary.
 * Maps command prefixes to the number of tokens that form a
 * "human-understandable command" for permission grouping.
 *
 * Example: "npm run test" → arity 3 → "npm run test"
 *          "git checkout -b feat" → arity 2 → "git checkout"
 *
 * When a user clicks "always allow", the arity determines how broad
 * the pattern is. e.g., "always allow git checkout *" (arity 2)
 * rather than "always allow git checkout -b feature-x" (too specific).
 */
export namespace BashArity {
	/**
	 * Extract the "human-readable command prefix" from shell tokens.
	 * Uses the arity dictionary to determine how many tokens form the command.
	 *
	 * @param tokens - Shell command split into tokens
	 * @returns The tokens that form the command prefix
	 */
	export function prefix(tokens: string[]): string[] {
		// Try longest prefix first
		for (let len = tokens.length; len > 0; len--) {
			const key = tokens.slice(0, len).join(" ")
			const arity = ARITY[key]
			if (arity !== undefined) return tokens.slice(0, arity)
		}
		// Fallback: first token is the command
		if (tokens.length === 0) return []
		return tokens.slice(0, 1)
	}

	const ARITY: Record<string, number> = {
		cat: 1,
		cd: 1,
		chmod: 1,
		chown: 1,
		cp: 1,
		echo: 1,
		env: 1,
		export: 1,
		grep: 1,
		kill: 1,
		killall: 1,
		ln: 1,
		ls: 1,
		mkdir: 1,
		mv: 1,
		ps: 1,
		pwd: 1,
		rm: 1,
		rmdir: 1,
		sleep: 1,
		source: 1,
		tail: 1,
		touch: 1,
		unset: 1,
		which: 1,
		aws: 3,
		az: 3,
		bazel: 2,
		brew: 2,
		bun: 2,
		"bun run": 3,
		"bun x": 3,
		cargo: 2,
		"cargo add": 3,
		"cargo run": 3,
		cdk: 2,
		cf: 2,
		cmake: 2,
		composer: 2,
		consul: 2,
		"consul kv": 3,
		deno: 2,
		"deno task": 3,
		docker: 2,
		"docker compose": 3,
		"docker container": 3,
		"docker image": 3,
		"docker network": 3,
		"docker volume": 3,
		firebase: 2,
		flyctl: 2,
		gcloud: 3,
		gh: 3,
		git: 2,
		"git config": 3,
		"git remote": 3,
		"git stash": 3,
		go: 2,
		gradle: 2,
		helm: 2,
		heroku: 2,
		hugo: 2,
		kubectl: 2,
		"kubectl rollout": 3,
		make: 2,
		mvn: 2,
		ng: 2,
		npm: 2,
		"npm exec": 3,
		"npm init": 3,
		"npm run": 3,
		"npm view": 3,
		nvm: 2,
		nx: 2,
		pip: 2,
		pipenv: 2,
		pnpm: 2,
		"pnpm dlx": 3,
		"pnpm exec": 3,
		"pnpm run": 3,
		poetry: 2,
		podman: 2,
		psql: 2,
		pulumi: 2,
		python: 2,
		rake: 2,
		"redis-cli": 2,
		rustup: 2,
		sst: 2,
		swift: 2,
		systemctl: 2,
		terraform: 2,
		"terraform workspace": 3,
		turbo: 2,
		vercel: 2,
		volta: 2,
		yarn: 2,
		"yarn dlx": 3,
		"yarn run": 3,
	}
}
