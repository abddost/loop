/**
 * Command arity system — normalizes commands to permission patterns.
 *
 * Arity defines how many leading words form the "command identity":
 *   - arity 1: `ls` -> pattern `ls *`
 *   - arity 2: `git checkout` -> pattern `git checkout *`
 *   - arity 3: `npm run dev` -> pattern `npm run dev`
 *
 * Uses longest-prefix matching: tries "npm run" (arity 3) before "npm" (arity 2).
 */

/**
 * Map of command (or multi-word prefix) -> arity (total words in identity).
 * Matches opencode's arity table exactly.
 */
const ARITY_MAP: Record<string, number> = {
  // Simple commands (arity 1)
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

  // Cloud providers (arity 3)
  aws: 3,
  az: 3,

  // Build tools & runtimes (arity 2)
  bazel: 2,
  brew: 2,
  bun: 2,
  'bun run': 3,
  'bun x': 3,
  cargo: 2,
  'cargo add': 3,
  'cargo run': 3,
  cdk: 2,
  cf: 2,
  cmake: 2,
  composer: 2,
  consul: 2,
  'consul kv': 3,
  crictl: 2,
  deno: 2,
  'deno task': 3,
  doctl: 3,
  docker: 2,
  'docker builder': 3,
  'docker compose': 3,
  'docker container': 3,
  'docker image': 3,
  'docker network': 3,
  'docker volume': 3,
  eksctl: 2,
  'eksctl create': 3,
  firebase: 2,
  flyctl: 2,
  gcloud: 3,
  gh: 3,
  git: 2,
  'git config': 3,
  'git remote': 3,
  'git stash': 3,
  go: 2,
  gradle: 2,
  helm: 2,
  heroku: 2,
  hugo: 2,
  ip: 2,
  'ip addr': 3,
  'ip link': 3,
  'ip netns': 3,
  'ip route': 3,
  kind: 2,
  'kind create': 3,
  kubectl: 2,
  'kubectl kustomize': 3,
  'kubectl rollout': 3,
  kustomize: 2,
  make: 2,
  mc: 2,
  'mc admin': 3,
  minikube: 2,
  mongosh: 2,
  mysql: 2,
  mvn: 2,
  ng: 2,
  npm: 2,
  'npm exec': 3,
  'npm init': 3,
  'npm run': 3,
  'npm view': 3,
  nvm: 2,
  nx: 2,
  openssl: 2,
  'openssl req': 3,
  'openssl x509': 3,
  pip: 2,
  pipenv: 2,
  pnpm: 2,
  'pnpm dlx': 3,
  'pnpm exec': 3,
  'pnpm run': 3,
  poetry: 2,
  podman: 2,
  'podman container': 3,
  'podman image': 3,
  psql: 2,
  pulumi: 2,
  'pulumi stack': 3,
  pyenv: 2,
  python: 2,
  rake: 2,
  rbenv: 2,
  'redis-cli': 2,
  rustup: 2,
  serverless: 2,
  sfdx: 3,
  skaffold: 2,
  sls: 2,
  sst: 2,
  swift: 2,
  systemctl: 2,
  terraform: 2,
  'terraform workspace': 3,
  tmux: 2,
  turbo: 2,
  ufw: 2,
  vault: 2,
  'vault auth': 3,
  'vault kv': 3,
  vercel: 2,
  volta: 2,
  wp: 2,
  yarn: 2,
  'yarn dlx': 3,
  'yarn run': 3,
};

/**
 * Parse a command string into words, respecting quoted segments.
 */
function parseWords(commandStr: string): string[] {
  const matches = commandStr.trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g);
  if (!matches) return [];
  return matches.map((w) =>
    (w.startsWith('"') || w.startsWith("'")) ? w.slice(1, -1) : w,
  );
}

/**
 * Look up the arity for a command name.
 */
export function getCommandArity(command: string): number {
  return ARITY_MAP[command] ?? 1;
}

/**
 * Normalize a full command string to a permission pattern.
 *
 * Uses longest-prefix matching (like opencode's BashArity.prefix()):
 * tries "npm run" (arity 3) before "npm" (arity 2).
 *
 * Examples:
 *   "git checkout main"  -> "git checkout *"
 *   "npm run dev"         -> "npm run dev"
 *   "npm run dev --watch" -> "npm run *"
 *   "ls -la /tmp"         -> "ls *"
 *   "unknown-tool foo"    -> "unknown-tool *"
 */
export function normalizeToPattern(commandStr: string): string {
  const words = parseWords(commandStr);
  if (words.length === 0) return '*';

  // Try longest prefix match first
  for (let len = words.length; len > 0; len--) {
    const prefix = words.slice(0, len).join(' ');
    const arity = ARITY_MAP[prefix];
    if (arity !== undefined) {
      const identity = words.slice(0, arity);
      return words.length > arity
        ? identity.join(' ') + ' *'
        : identity.join(' ');
    }
  }

  // Fallback: first word + wildcard
  return words.length > 1 ? words[0] + ' *' : words[0];
}

/**
 * Check if a command string matches a permission pattern (wildcard-aware).
 *
 * Examples:
 *   matchesPattern("git checkout main", "git checkout *") -> true
 *   matchesPattern("git push origin main", "git checkout *") -> false
 *   matchesPattern("ls", "ls") -> true
 */
export function matchesPattern(command: string, pattern: string): boolean {
  const commandWords = parseWords(command);
  const patternWords = parseWords(pattern);

  if (patternWords.length === 0) return commandWords.length === 0;

  const endsWithWildcard = patternWords[patternWords.length - 1] === '*';
  const identityParts = endsWithWildcard ? patternWords.slice(0, -1) : patternWords;

  // Command must have at least as many words as the pattern identity
  if (commandWords.length < identityParts.length) return false;

  // All identity parts must match exactly
  for (let i = 0; i < identityParts.length; i++) {
    if (commandWords[i] !== identityParts[i]) return false;
  }

  // Without wildcard, lengths must match exactly
  if (!endsWithWildcard && commandWords.length !== identityParts.length) return false;

  return true;
}
