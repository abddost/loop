/**
 * Command arity system — normalizes commands to permission patterns.
 *
 * Arity defines how many leading words form the "command identity":
 *   - arity 1: `ls` -> pattern `ls *`
 *   - arity 2: `git checkout` -> pattern `git checkout *`
 *   - arity 3: `kubectl get pods` -> pattern `kubectl get pods *`
 */

/** Map of command -> arity (number of leading words that form the identity) */
const ARITY_MAP: Record<string, number> = {
  // Version control
  git: 2,
  svn: 2,
  hg: 2,

  // Package managers
  npm: 2,
  npx: 1,
  yarn: 2,
  pnpm: 2,
  bun: 2,
  pip: 2,
  pip3: 2,
  cargo: 2,
  go: 2,
  gem: 2,
  composer: 2,

  // Container/orchestration
  docker: 2,
  'docker-compose': 2,
  podman: 2,
  kubectl: 2,
  helm: 2,

  // System
  apt: 2,
  'apt-get': 2,
  brew: 2,
  yum: 2,
  dnf: 2,
  pacman: 2,
  snap: 2,
  systemctl: 2,

  // Build tools
  make: 1,
  cmake: 1,
  gradle: 1,
  mvn: 1,

  // Simple commands (arity 1)
  ls: 1,
  cat: 1,
  cp: 1,
  mv: 1,
  rm: 1,
  mkdir: 1,
  rmdir: 1,
  chmod: 1,
  chown: 1,
  find: 1,
  grep: 1,
  sed: 1,
  awk: 1,
  echo: 1,
  cd: 1,
  pwd: 1,
  touch: 1,
  ln: 1,
  tar: 1,
  curl: 1,
  wget: 1,
  ssh: 1,
  scp: 1,
  rsync: 1,
  python: 1,
  python3: 1,
  node: 1,
  ruby: 1,
  perl: 1,
  java: 1,
  javac: 1,
};

/** Default arity for unknown commands */
const DEFAULT_ARITY = 1;

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
  return ARITY_MAP[command] ?? DEFAULT_ARITY;
}

/**
 * Normalize a full command string to a permission pattern.
 *
 * Examples:
 *   "git checkout main"  -> "git checkout *"
 *   "ls -la /tmp"        -> "ls *"
 *   "unknown-tool foo"   -> "unknown-tool *"
 */
export function normalizeToPattern(commandStr: string): string {
  const words = parseWords(commandStr);
  if (words.length === 0) return '*';

  const arity = getCommandArity(words[0]);
  const identityWords = words.slice(0, arity);

  // If the command has more words than the arity, append wildcard
  if (words.length > arity) {
    return identityWords.join(' ') + ' *';
  }

  // Exact match when no extra arguments
  return identityWords.join(' ');
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
