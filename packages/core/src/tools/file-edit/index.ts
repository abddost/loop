/**
 * File-edit utilities -- shared modules for file manipulation tools.
 */

export { replace, normalizeLineEndings, levenshtein, similarity } from './replacers.js';
export type { ReplaceResult, ReplaceMatch } from './replacers.js';

export { generateUnifiedDiff, computeDiffStats, trimDiff } from './diff.js';

export { assertFileReadBeforeWrite } from './file-time.js';

export {
  isBinaryFile,
  isBinaryByExtension,
  isBinaryByContent,
  isImageByExtension,
  describeBinaryFile,
  BINARY_EXTENSIONS,
  IMAGE_EXTENSIONS,
} from './binary-detect.js';

export { emitFileChange } from './events.js';
export type { FileChangeEvent, FileChangeType } from './events.js';
