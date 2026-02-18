/**
 * Binary file detection -- prevents reading binary files as text
 * (which wastes tokens and confuses the LLM) and prevents edits
 * that would corrupt binary data.
 *
 * Two-layer detection:
 * 1. Extension-based (fast path) -- 170+ known binary extensions
 * 2. Content-based (fallback) -- null byte and non-printable character check
 */

import { extname } from 'node:path';

// ─── Binary Extensions ─────────────────────────────────────────────

/** Comprehensive set of known binary file extensions (lowercase, without dot). */
export const BINARY_EXTENSIONS = new Set([
  // Executables & libraries
  'exe', 'dll', 'so', 'dylib', 'bin', 'com', 'msi', 'app', 'deb', 'rpm',
  'dmg', 'iso', 'img', 'o', 'obj', 'a', 'lib', 'class', 'pyc', 'pyo',
  'wasm', 'elf',

  // Archives & compressed
  'zip', 'tar', 'gz', 'bz2', 'xz', 'lz', 'lzma', '7z', 'rar', 'zst',
  'cab', 'ar', 'cpio', 'lz4', 'br', 'tgz',

  // Images
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'tif', 'tiff', 'webp',
  'avif', 'heic', 'heif', 'raw', 'cr2', 'nef', 'psd', 'ai', 'eps',
  'svg+xml', 'xcf', 'dds', 'ktx', 'ktx2', 'jxl',

  // Audio
  'mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'opus', 'mid',
  'midi', 'aiff', 'ape', 'ac3',

  // Video
  'mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpeg',
  'mpg', '3gp', 'ogv', 'mts',

  // Documents (binary format)
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods',
  'odp', 'rtf', 'pages', 'numbers', 'key',

  // Fonts
  'ttf', 'otf', 'woff', 'woff2', 'eot',

  // Database
  'db', 'sqlite', 'sqlite3', 'mdb', 'accdb',

  // 3D / Graphics
  'blend', 'fbx', 'glb', 'gltf', 'stl', 'dae',

  // Certificates & keys (binary format)
  'p12', 'pfx', 'cer', 'der', 'keystore', 'jks',

  // Misc binary-ish
  'pak', 'dat',

  'swf', 'fla', 'swc',
]);

/** Image extensions (subset of binary) -- for potential special handling. */
export const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'tif', 'tiff', 'webp',
  'avif', 'heic', 'heif', 'raw', 'cr2', 'nef', 'psd', 'svg', 'jxl',
  'xcf', 'dds', 'ktx', 'ktx2',
]);

// ─── Detection Functions ───────────────────────────────────────────

/**
 * Check if a file is binary by its extension.
 */
export function isBinaryByExtension(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase().replace(/^\./, '');
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * Check if a file is an image by its extension.
 */
export function isImageByExtension(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase().replace(/^\./, '');
  return IMAGE_EXTENSIONS.has(ext);
}

/**
 * Check if a buffer contains binary content.
 * Looks for null bytes and a high ratio of non-printable characters.
 */
export function isBinaryByContent(buffer: Buffer): boolean {
  // Check first 8KB for binary indicators
  const checkSize = Math.min(buffer.length, 8192);
  let nonPrintable = 0;

  for (let i = 0; i < checkSize; i++) {
    const byte = buffer[i];

    // Null byte is a strong binary indicator
    if (byte === 0) return true;

    // Count non-printable characters (excluding common whitespace)
    // Printable ASCII: 0x20-0x7E, plus TAB (0x09), LF (0x0A), CR (0x0D)
    // UTF-8 multi-byte sequences (0xC0+) are valid text, skip them
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0A && byte !== 0x0D) {
      nonPrintable++;
    } else if (byte === 0x7F) {
      // DEL character
      nonPrintable++;
    }
  }

  // If >30% of checked bytes are non-printable, treat as binary
  return checkSize > 0 && nonPrintable / checkSize > 0.3;
}

/**
 * Check if a file is binary using both extension and content checks.
 * Extension check is tried first (fast path), then content check.
 */
export async function isBinaryFile(filePath: string): Promise<boolean> {
  // Fast path: check extension
  if (isBinaryByExtension(filePath)) return true;

  // Slow path: read first 8KB chunk and check content
  try {
    const slice = Bun.file(filePath).slice(0, 8192);
    const ab = await slice.arrayBuffer();
    const buffer = Buffer.from(ab);
    return isBinaryByContent(buffer);
  } catch {
    // If we can't read it, assume text (let the read tool handle the error)
    return false;
  }
}

/**
 * Get a human-readable description for a binary file.
 */
export function describeBinaryFile(filePath: string, sizeBytes: number): string {
  const ext = extname(filePath).toLowerCase().replace(/^\./, '') || 'unknown';
  const sizeStr = sizeBytes < 1024
    ? `${sizeBytes} bytes`
    : sizeBytes < 1024 * 1024
      ? `${(sizeBytes / 1024).toFixed(1)} KB`
      : `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  return `[Binary file: .${ext}, ${sizeStr}]`;
}
