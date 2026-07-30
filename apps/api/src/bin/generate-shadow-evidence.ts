/**
 * The `qfj-generate-shadow-evidence` process entry (QFJ-S2-E-B).
 *
 * The ONLY module that reads `process.argv` or sets an exit code. It touches no credential, constructs
 * no provider, and makes no network call.
 */
import {
  defaultEvidenceCliIo,
  generateShadowEvidenceCli,
} from '../cli/generate-shadow-evidence.js';

process.exitCode = await generateShadowEvidenceCli(process.argv.slice(2), defaultEvidenceCliIo());
