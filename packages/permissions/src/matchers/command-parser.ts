/**
 * Shell command parser for permission evaluation.
 */

export interface ParsedCommand {
  command: string;
  args: string[];
  raw: string;
  pipes: ParsedCommand[];
  isChained: boolean;
}

/**
 * Parse a shell command string into structured form.
 * Handles pipes, chains, and basic argument parsing.
 */
export function parseCommand(raw: string): ParsedCommand {
  const trimmed = raw.trim();

  // Handle pipes
  if (trimmed.includes(' | ')) {
    const parts = trimmed.split(' | ').map((p) => p.trim());
    const first = parseSimpleCommand(parts[0]);
    first.pipes = parts.slice(1).map(parseSimpleCommand);
    return first;
  }

  // Handle chains (&&, ;)
  if (trimmed.includes(' && ') || trimmed.includes(' ; ')) {
    const result = parseSimpleCommand(trimmed.split(/\s*(?:&&|;)\s*/)[0]);
    result.isChained = true;
    return result;
  }

  return parseSimpleCommand(trimmed);
}

function parseSimpleCommand(raw: string): ParsedCommand {
  const parts = raw.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [raw];
  const command = parts[0] ?? '';
  const args = parts.slice(1).map((a) =>
    a.startsWith('"') || a.startsWith("'") ? a.slice(1, -1) : a,
  );

  return {
    command,
    args,
    raw,
    pipes: [],
    isChained: false,
  };
}

/**
 * Check if a command matches a denied pattern.
 */
export function isDeniedCommand(raw: string, deniedPatterns: string[]): boolean {
  const trimmed = raw.trim().toLowerCase();
  return deniedPatterns.some((pattern) => {
    const lower = pattern.toLowerCase();
    return trimmed === lower || trimmed.startsWith(lower + ' ');
  });
}
