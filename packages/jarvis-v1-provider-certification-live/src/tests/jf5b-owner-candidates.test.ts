/**
 * JF-5B-R25: the historical Nara owner-candidate surface is retired from live certification.
 *
 * Historical discovery/shortlist helpers remain independently tested for audit reproducibility. This
 * file pins the release boundary: the current parser cannot accept a Nara candidate and the preflight
 * cannot present one for owner selection.
 */
import { describe, expect, it } from 'vitest';

import { NARA_CANDIDATE_FLAG, parseCertifyArgv, renderPreflightSummary } from '../cli/preflight.js';
import { EXECUTE_LIVE_FLAG } from '../contracts/live-execution-gate.js';

const summary = (naraCandidates: readonly string[] = []): string =>
  renderPreflightSummary({
    headSha: 'b'.repeat(40),
    worktreeClean: true,
    ciRunId: '34606043399',
    ciConclusion: 'success',
    outputDirectory: 'D:/jarvis-certification/JF-5B/run-r25',
    runId: 'run.jf5b.r25',
    groqCertificationModelId: 'openai/gpt-oss-120b',
    naraCandidates,
  }).join('\n');
describe('JF-5B-R25 retired Nara CLI surface', () => {
  it('treats both Nara candidate spellings as unknown arguments', () => {
    const split = parseCertifyArgv([EXECUTE_LIVE_FLAG, NARA_CANDIDATE_FLAG, 'agnes-2.5-flash']);
    expect(split.naraCandidates).toEqual([]);
    expect(split.unknown).toEqual([NARA_CANDIDATE_FLAG, 'agnes-2.5-flash']);

    const inline = parseCertifyArgv([EXECUTE_LIVE_FLAG, `${NARA_CANDIDATE_FLAG}=agnes-2.5-flash`]);
    expect(inline.naraCandidates).toEqual([]);
    expect(inline.unknown).toEqual([`${NARA_CANDIDATE_FLAG}=agnes-2.5-flash`]);
  });

  it('still accepts only the Groq live-certification controls', () => {
    const parsed = parseCertifyArgv([
      EXECUTE_LIVE_FLAG,
      '--output-dir',
      'D:/out',
      '--groq-smoke-config=config.json',
    ]);
    expect(parsed).toEqual({
      executeLive: true,
      outputDirectory: 'D:/out',
      groqSmokeConfig: 'config.json',
      naraCandidates: [],
      unknown: [],
    });
  });
  it('renders Groq-only facts and no candidate-selection channel', () => {
    const text = summary(['historical-input-is-ignored']);
    expect(text).toContain('provider mode          GROQ_ONLY');
    expect(text).toContain('providers              groq only');
    expect(text).toContain('max nara calls         0 (hard-disabled)');
    expect(text).toContain('nara                   DISABLED');
    expect(text).toContain('provider fallback      NONE');
    expect(text).not.toContain('nara candidate source');
    expect(text).not.toContain('nara candidate 1');
    expect(text).not.toContain('historical-input-is-ignored');
  });

  it('shows the Groq-only posture before the human execution phrase', () => {
    const text = summary();
    expect(text.indexOf('provider mode          GROQ_ONLY')).toBeLessThan(
      text.indexOf('To proceed, type exactly'),
    );
    expect(text.indexOf('nara                   DISABLED')).toBeLessThan(
      text.indexOf('To proceed, type exactly'),
    );
  });

  it('does not leak credential terminology into preflight', () => {
    expect(summary().toLowerCase()).not.toContain(['api', 'key'].join('-'));
  });
});
