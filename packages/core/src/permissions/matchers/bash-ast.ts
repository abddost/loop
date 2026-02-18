/**
 * Lightweight AST-based bash command parser for permission evaluation.
 * Recursive-descent parser — no WASM, no external dependencies.
 */

export interface CommandNode {
  name: string;
  args: string[];
  raw: string;
  type: 'simple' | 'pipe' | 'chain' | 'subshell';
}

// --- Tokenizer ---

const enum TokenKind {
  Word,
  Pipe,        // |
  And,         // &&
  Or,          // ||
  Semi,        // ;
  LParen,      // (
  RParen,      // )
  Redirect,    // >, >>, <, 2>, 2>>, &>, etc.
  RedirectTarget, // the path/fd following a redirect operator
}

interface Token {
  kind: TokenKind;
  value: string;
}

const REDIRECT_RE = /^(?:&>>|&>|2>>|2>|>>|>|<)/;
const OPERATOR_CHARS = new Set(['|', '&', ';', '(', ')', '<', '>', '\n']);

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = input.length;

  function peek(): string {
    return i < len ? input[i] : '';
  }

  function advance(): string {
    return input[i++];
  }

  function skipWhitespace(): void {
    while (i < len && (input[i] === ' ' || input[i] === '\t')) {
      i++;
    }
  }

  function readSingleQuoted(): string {
    // Opening ' already consumed
    let result = '';
    while (i < len) {
      const ch = advance();
      if (ch === "'") return result;
      result += ch;
    }
    // Unterminated single quote — return what we have
    return result;
  }

  function readDoubleQuoted(): string {
    // Opening " already consumed
    let result = '';
    while (i < len) {
      const ch = advance();
      if (ch === '"') return result;
      if (ch === '\\' && i < len) {
        const next = peek();
        if (next === '"' || next === '\\' || next === '$' || next === '`') {
          result += advance();
          continue;
        }
      }
      if (ch === '$' && peek() === '(') {
        // Inline command substitution inside double quotes — include literally
        result += '$' + readSubstitutionRaw();
        continue;
      }
      if (ch === '`') {
        result += '`' + readBacktickRaw() + '`';
        continue;
      }
      result += ch;
    }
    return result;
  }

  /** Read $(...) content including parens, return "(inner)" */
  function readSubstitutionRaw(): string {
    // $ already consumed, expect (
    advance(); // consume (
    let depth = 1;
    let content = '(';
    while (i < len && depth > 0) {
      const ch = advance();
      content += ch;
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === "'" ) {
        const inner = readSingleQuoted();
        content += inner + "'";
      } else if (ch === '"') {
        const inner = readDoubleQuoted();
        content += inner + '"';
      }
    }
    return content;
  }

  /** Read backtick-delimited content, return the inner string (without outer backticks) */
  function readBacktickRaw(): string {
    let content = '';
    while (i < len) {
      const ch = advance();
      if (ch === '`') return content;
      if (ch === '\\' && i < len && peek() === '`') {
        content += advance();
        continue;
      }
      content += ch;
    }
    return content;
  }

  function readWord(): string {
    let word = '';
    while (i < len) {
      const ch = peek();
      if (ch === ' ' || ch === '\t' || ch === '\n') break;
      if (OPERATOR_CHARS.has(ch) && ch !== '&') break;
      // & is an operator only if followed by & or > or at end-of-word
      if (ch === '&') {
        if (i + 1 < len && (input[i + 1] === '&' || input[i + 1] === '>')) break;
        // standalone & at end or before space — treat as operator
        if (i + 1 >= len || input[i + 1] === ' ' || input[i + 1] === '\t') break;
      }
      advance();
      if (ch === "'") {
        word += readSingleQuoted();
      } else if (ch === '"') {
        word += readDoubleQuoted();
      } else if (ch === '\\' && i < len) {
        word += advance(); // escaped char
      } else if (ch === '$' && peek() === '(') {
        word += '$' + readSubstitutionRaw();
      } else if (ch === '`') {
        word += '`' + readBacktickRaw() + '`';
      } else {
        word += ch;
      }
    }
    return word;
  }

  while (i < len) {
    skipWhitespace();
    if (i >= len) break;
    const ch = peek();

    // Newlines act like semicolons
    if (ch === '\n') {
      advance();
      tokens.push({ kind: TokenKind.Semi, value: ';' });
      continue;
    }

    // Check for redirect operators (must be checked before generic > handling)
    const remaining = input.slice(i);
    const rMatch = remaining.match(REDIRECT_RE);
    if (rMatch) {
      const op = rMatch[0];
      i += op.length;
      tokens.push({ kind: TokenKind.Redirect, value: op });
      // The next token is the redirect target (may be &N for fd redirect)
      skipWhitespace();
      if (i < len && peek() === '&') {
        // fd redirect like 2>&1 — consume &N as redirect target
        let fdTarget = '';
        fdTarget += advance(); // consume &
        while (i < len && input[i] >= '0' && input[i] <= '9') {
          fdTarget += advance();
        }
        tokens.push({ kind: TokenKind.RedirectTarget, value: fdTarget });
      } else if (i < len && peek() !== '\n' && !OPERATOR_CHARS.has(peek())) {
        const target = readWord();
        tokens.push({ kind: TokenKind.RedirectTarget, value: target });
      }
      continue;
    }

    if (ch === '|') {
      advance();
      if (peek() === '|') {
        advance();
        tokens.push({ kind: TokenKind.Or, value: '||' });
      } else {
        tokens.push({ kind: TokenKind.Pipe, value: '|' });
      }
      continue;
    }

    if (ch === '&') {
      if (i + 1 < len && input[i + 1] === '&') {
        advance(); advance();
        tokens.push({ kind: TokenKind.And, value: '&&' });
        continue;
      }
      if (i + 1 < len && (input[i + 1] === '>' )) {
        // &> or &>> redirect
        const rSlice = input.slice(i);
        const rm = rSlice.match(REDIRECT_RE);
        if (rm) {
          i += rm[0].length;
          tokens.push({ kind: TokenKind.Redirect, value: rm[0] });
          skipWhitespace();
          if (i < len && peek() !== '\n') {
            const target = readWord();
            tokens.push({ kind: TokenKind.RedirectTarget, value: target });
          }
          continue;
        }
      }
      // background & — treat as semicolon
      advance();
      tokens.push({ kind: TokenKind.Semi, value: ';' });
      continue;
    }

    if (ch === ';') {
      advance();
      tokens.push({ kind: TokenKind.Semi, value: ';' });
      continue;
    }

    if (ch === '(') {
      advance();
      tokens.push({ kind: TokenKind.LParen, value: '(' });
      continue;
    }

    if (ch === ')') {
      advance();
      tokens.push({ kind: TokenKind.RParen, value: ')' });
      continue;
    }

    // Default: read a word
    const word = readWord();
    if (word.length > 0) {
      tokens.push({ kind: TokenKind.Word, value: word });
    }
  }

  return tokens;
}

// --- Parser ---

function parseTokens(tokens: Token[]): CommandNode[] {
  const results: CommandNode[] = [];
  let pos = 0;

  function current(): Token | undefined {
    return tokens[pos];
  }

  function eat(): Token {
    return tokens[pos++];
  }

  function isOperator(t: Token | undefined): boolean {
    if (!t) return false;
    return (
      t.kind === TokenKind.Pipe ||
      t.kind === TokenKind.And ||
      t.kind === TokenKind.Or ||
      t.kind === TokenKind.Semi
    );
  }

  /** Parse a simple command (words + redirections) until an operator, RParen, or EOF */
  function parseSimple(): CommandNode | null {
    const words: string[] = [];
    const rawParts: string[] = [];

    while (pos < tokens.length) {
      const t = current();
      if (!t) break;
      if (isOperator(t) || t.kind === TokenKind.RParen) break;

      if (t.kind === TokenKind.LParen) {
        // Subshell
        eat(); // consume (
        const inner = parseSequence();
        results.push(...inner);
        if (current()?.kind === TokenKind.RParen) eat();
        // If there were no words before the paren, we don't produce a simple node
        if (words.length === 0) return null;
        continue;
      }

      if (t.kind === TokenKind.Redirect) {
        eat(); // consume redirect operator
        // Skip the redirect target if present
        if (current()?.kind === TokenKind.RedirectTarget) eat();
        continue;
      }

      if (t.kind === TokenKind.RedirectTarget) {
        // Orphaned redirect target — skip
        eat();
        continue;
      }

      if (t.kind === TokenKind.Word) {
        const word = t.value;
        // Check for inline command substitution as the entire word: $(...)
        if (word.startsWith('$(') && word.endsWith(')')) {
          const inner = word.slice(2, -1);
          const subTokens = tokenize(inner);
          const subCommands = parseTokens(subTokens);
          for (const sc of subCommands) {
            sc.type = 'subshell';
            results.push(sc);
          }
          eat();
          continue;
        }
        // Check for backtick substitution as entire word
        if (word.startsWith('`') && word.endsWith('`') && word.length > 1) {
          const inner = word.slice(1, -1);
          const subTokens = tokenize(inner);
          const subCommands = parseTokens(subTokens);
          for (const sc of subCommands) {
            sc.type = 'subshell';
            results.push(sc);
          }
          eat();
          continue;
        }
        words.push(word);
        rawParts.push(word);
        eat();
        continue;
      }

      // Any other token type — skip
      eat();
    }

    if (words.length === 0) return null;

    return {
      name: words[0],
      args: words.slice(1),
      raw: rawParts.join(' '),
      type: 'simple',
    };
  }

  /** Parse a sequence of commands separated by operators */
  function parseSequence(): CommandNode[] {
    const cmds: CommandNode[] = [];

    while (pos < tokens.length) {
      const t = current();
      if (!t) break;
      if (t.kind === TokenKind.RParen) break;

      // Skip leading separators
      if (isOperator(t)) {
        eat();
        continue;
      }

      if (t.kind === TokenKind.LParen) {
        eat(); // consume (
        const inner = parseSequence();
        for (const c of inner) {
          c.type = 'subshell';
        }
        cmds.push(...inner);
        if (current()?.kind === TokenKind.RParen) eat();
        continue;
      }

      const cmd = parseSimple();
      if (cmd) {
        // Determine type based on what operator follows
        const next = current();
        if (next?.kind === TokenKind.Pipe) {
          cmd.type = 'pipe';
        } else if (next?.kind === TokenKind.And || next?.kind === TokenKind.Or) {
          cmd.type = 'chain';
        }
        cmds.push(cmd);
      }
    }

    return cmds;
  }

  results.push(...parseSequence());
  return results;
}

// --- Public API ---

/**
 * Extract a flat list of all commands from a bash command string,
 * including nested commands in subshells and command substitutions.
 */
export function extractCommands(input: string): CommandNode[] {
  if (!input || !input.trim()) return [];
  const tokens = tokenize(input.trim());
  return parseTokens(tokens);
}

/**
 * Extract just the command names from a bash command string.
 * Useful for deny-list checking.
 */
export function extractCommandNames(input: string): string[] {
  return extractCommands(input).map((c) => c.name);
}

/**
 * Extract file paths referenced by monitored file-manipulation commands.
 * Looks at arguments of rm, cp, mv, mkdir, touch, chmod, chown, cat, cd, rmdir, ln,
 * skipping flags (arguments starting with -).
 */
const MONITORED_COMMANDS = new Set([
  'rm', 'cp', 'mv', 'mkdir', 'touch', 'chmod', 'chown', 'cat', 'cd', 'rmdir', 'ln',
]);

export function extractReferencedPaths(input: string): string[] {
  const commands = extractCommands(input);
  const paths: string[] = [];

  for (const cmd of commands) {
    if (!MONITORED_COMMANDS.has(cmd.name)) continue;
    for (const arg of cmd.args) {
      if (!arg.startsWith('-')) {
        paths.push(arg);
      }
    }
  }

  return paths;
}
