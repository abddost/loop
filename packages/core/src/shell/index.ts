/**
 * Shell management -- barrel export.
 */

export { Shell } from './shell.js';
export type { ShellInfo } from './shell.js';

export { classifyExitError, errorKindMessage, semanticExitCode } from './errors.js';
export type { BashErrorKind, BashExitInfo } from './errors.js';

export { truncateOutput, cleanupOldOutputs, isBinaryOutput } from './truncation.js';
export type { TruncationConfig, TruncationResult } from './truncation.js';
