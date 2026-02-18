/**
 * Output truncation system — smart output management for bash tool.
 * Saves full output to disk when it exceeds limits, returns truncated preview.
 */

import { writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export interface TruncationConfig {
  /** Maximum number of output lines before truncation (default: 2000) */
  maxLines: number;
  /** Maximum byte size before truncation (default: 50_000) */
  maxBytes: number;
  /** Which end to keep: 'tail' keeps last N lines, 'head' keeps first N (default: 'tail') */
  direction: 'head' | 'tail';
  /** Directory for saving full outputs (default: os.tmpdir()/coding-assistant-bash) */
  storageDir?: string;
  /** Days to retain saved output files (default: 7) */
  retentionDays: number;
}

export interface TruncationResult {
  content: string;
  wasTruncated: boolean;
  fullOutputPath?: string;
  originalLines: number;
  originalBytes: number;
  hint?: string;
}

const DEFAULT_CONFIG: TruncationConfig = {
  maxLines: 2000,
  maxBytes: 50_000,
  direction: 'tail',
  retentionDays: 7,
};

const OUTPUT_FILE_PREFIX = 'bash-output-';
const OUTPUT_FILE_SUFFIX = '.txt';

/**
 * Detect whether the output appears to be binary content.
 * Checks for null bytes or a high ratio of non-printable characters.
 */
export function isBinaryOutput(raw: string): boolean {
  if (raw.length === 0) return false;

  // Null bytes are a strong indicator of binary
  if (raw.includes('\0')) return true;

  // Sample up to 1024 chars to check non-printable ratio
  const sample = raw.slice(0, 1024);
  let nonPrintable = 0;
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    // Allow tab (9), newline (10), carriage return (13), and printable ASCII (32-126)
    if (code !== 9 && code !== 10 && code !== 13 && (code < 32 || code > 126)) {
      nonPrintable++;
    }
  }

  return nonPrintable / sample.length > 0.3;
}

/**
 * Resolve the storage directory path, creating it if necessary.
 */
function resolveStorageDir(dir?: string): string {
  const resolved = dir ?? join(tmpdir(), 'coding-assistant-bash');
  mkdirSync(resolved, { recursive: true });
  return resolved;
}

/**
 * Save full output to disk and return the file path.
 * Returns undefined if saving fails (e.g. disk full).
 */
function saveFullOutput(raw: string, storageDir: string): string | undefined {
  const filename = `${OUTPUT_FILE_PREFIX}${crypto.randomUUID()}${OUTPUT_FILE_SUFFIX}`;
  const filepath = join(storageDir, filename);

  try {
    writeFileSync(filepath, raw, 'utf-8');
    return filepath;
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === 'ENOSPC') return undefined;
    throw err;
  }
}

/**
 * Truncate bash output that exceeds configured limits.
 * When truncated, saves the full output to disk for later retrieval.
 */
export function truncateOutput(
  raw: string,
  config?: Partial<TruncationConfig>,
): TruncationResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const originalBytes = Buffer.byteLength(raw, 'utf-8');
  const lines = raw.split('\n');
  const originalLines = lines.length;

  // Empty output — return immediately
  if (raw.length === 0) {
    return { content: '', wasTruncated: false, originalLines: 0, originalBytes: 0 };
  }

  // Binary output — return placeholder
  if (isBinaryOutput(raw)) {
    return {
      content: `[Binary output detected - ${originalBytes} bytes]`,
      wasTruncated: true,
      originalLines,
      originalBytes,
      hint: 'Output appears to be binary. Use file-read on the source file instead.',
    };
  }

  // Check if truncation is needed
  const exceedsLines = originalLines > cfg.maxLines;
  const exceedsBytes = originalBytes > cfg.maxBytes;

  if (!exceedsLines && !exceedsBytes) {
    return { content: raw, wasTruncated: false, originalLines, originalBytes };
  }

  // Save full output to disk
  const storageDir = resolveStorageDir(cfg.storageDir);
  const fullOutputPath = saveFullOutput(raw, storageDir);

  // Truncate by lines first
  let truncatedLines: string[];
  if (exceedsLines) {
    truncatedLines =
      cfg.direction === 'tail'
        ? lines.slice(-cfg.maxLines)
        : lines.slice(0, cfg.maxLines);
  } else {
    truncatedLines = lines;
  }

  let content = truncatedLines.join('\n');

  // Then truncate by bytes if still too large
  if (Buffer.byteLength(content, 'utf-8') > cfg.maxBytes) {
    if (cfg.direction === 'tail') {
      // Keep the end — encode, slice from the end, decode
      const buf = Buffer.from(content, 'utf-8');
      content = buf.slice(buf.length - cfg.maxBytes).toString('utf-8');
    } else {
      const buf = Buffer.from(content, 'utf-8');
      content = buf.slice(0, cfg.maxBytes).toString('utf-8');
    }
  }

  // Build hint
  let hint: string;
  if (fullOutputPath) {
    hint =
      `Full output (${originalLines} lines, ${originalBytes} bytes) saved to ${fullOutputPath}. ` +
      'Use file-read or grep to access.';
  } else {
    hint =
      `Output truncated (${originalLines} lines, ${originalBytes} bytes). ` +
      'Warning: could not save full output to disk (insufficient space).';
  }

  return {
    content,
    wasTruncated: true,
    fullOutputPath,
    originalLines,
    originalBytes,
    hint,
  };
}

/**
 * Clean up saved output files older than the retention period.
 * Returns the number of files deleted.
 */
export function cleanupOldOutputs(dir?: string, retentionDays?: number): number {
  const days = retentionDays ?? DEFAULT_CONFIG.retentionDays;
  const storageDir = resolveStorageDir(dir);
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  let deleted = 0;

  let entries: string[];
  try {
    entries = readdirSync(storageDir);
  } catch {
    return 0;
  }

  for (const entry of entries) {
    if (!entry.startsWith(OUTPUT_FILE_PREFIX) || !entry.endsWith(OUTPUT_FILE_SUFFIX)) {
      continue;
    }

    const filepath = join(storageDir, entry);
    try {
      const stat = statSync(filepath);
      if (stat.mtimeMs < cutoff) {
        unlinkSync(filepath);
        deleted++;
      }
    } catch {
      // File may have been removed concurrently — skip
    }
  }

  return deleted;
}
