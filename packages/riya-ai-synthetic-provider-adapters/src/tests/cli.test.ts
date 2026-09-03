/**
 * The CLI, driven end to end with an injected environment (AS3A, ADR-0143 §14, §26).
 *
 * ### The one that would embarrass us most
 *
 * A CLI invoked WITH both credentials present and WITHOUT `--execute` must make zero provider calls
 * and say so. This spec runs exactly that, against a real plan file on disk, and the only thing
 * stopping a network call is the guard — no transport is even constructed, so a regression here does
 * not fail quietly, it fails by spending money.
 *
 * Every environment below holds credentials, because the empty environment proves nothing about a
 * guard whose entire job is to be independent of them.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ANTHROPIC_CREDENTIAL_ENV,
  OPENAI_CREDENTIAL_ENV,
  RIYA_AS3_EXECUTE_ENV,
} from '../service/execution-guard.js';
import {
  RIYA_AS3_EXIT_OK,
  RIYA_AS3_EXIT_RUNNER_FAILURE,
  RIYA_AS3_EXIT_USAGE,
  parseRiyaSyntheticCliArgs,
  runRiyaSyntheticPilotCli,
} from '../cli/pilot.js';
import { GPT_TAUGHT_ALLOCATION, pilotPlanInput } from './fixtures.js';

const WITH_CREDENTIALS = Object.freeze({
  [OPENAI_CREDENTIAL_ENV]: 'sk-not-a-real-key-fixture',
  [ANTHROPIC_CREDENTIAL_ENV]: 'sk-ant-not-a-real-key-fixture',
});

const created: string[] = [];

async function planFile(
  contents: unknown = pilotPlanInput({ allocations: [GPT_TAUGHT_ALLOCATION] }),
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'qfj-as3a-cli-'));
  created.push(directory);
  const path = join(directory, 'plan.json');
  await writeFile(path, JSON.stringify(contents), 'utf8');
  return path;
}

afterEach(async () => {
  for (const directory of created.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function run(
  argv: readonly string[],
  environment: Record<string, string | undefined>,
): Promise<{ readonly code: number; readonly output: string }> {
  const lines: string[] = [];
  const code = await runRiyaSyntheticPilotCli({
    argv,
    environment,
    now: () => 0,
    write: (line) => {
      lines.push(line);
    },
  });
  return { code, output: lines.join('\n') };
}

describe('the CLI defaults to a dry run', () => {
  it('makes zero provider calls with credentials present and no --execute', async () => {
    const path = await planFile();

    const { code, output } = await run(['--plan', path], WITH_CREDENTIALS);

    expect(code).toBe(RIYA_AS3_EXIT_OK);
    expect(output).toContain('mode: DRY_RUN');
    expect(output).toContain('provider requests: 0');
    expect(output).toContain('DRY RUN');
  }, 30_000);

  it('stays in a dry run when only the environment opt-in is set', async () => {
    const path = await planFile();

    const { output } = await run(['--plan', path], {
      ...WITH_CREDENTIALS,
      [RIYA_AS3_EXECUTE_ENV]: 'true',
    });

    expect(output).toContain('mode: DRY_RUN');
    expect(output).toContain('provider requests: 0');
  }, 30_000);

  it('stays in a dry run when only --execute is given', async () => {
    const path = await planFile();

    const { output } = await run(['--plan', path, '--execute'], WITH_CREDENTIALS);

    expect(output).toContain('mode: DRY_RUN');
    expect(output).toContain('provider requests: 0');
  }, 30_000);
});

describe('the CLI prints a summary that is safe to paste into a review', () => {
  it('reports credential PRESENCE, the ceilings and the model identities', async () => {
    const path = await planFile();

    const { output } = await run(['--plan', path], WITH_CREDENTIALS);

    expect(output).toContain('OPENAI_CREDENTIAL_PRESENT=true');
    expect(output).toContain('ANTHROPIC_CREDENTIAL_PRESENT=true');
    expect(output).toContain('ceiling provider requests:');
    expect(output).toContain('ceiling request input bytes:');
    expect(output).toContain('ceiling reserved output tokens:');
    expect(output).toContain('ceiling wall clock ms:');
    // HARD controls and OBSERVED thresholds are printed under different words, so a reader planning
    // a spend does not have to guess which of them is a wall.
    expect(output).toContain('observed threshold input tokens:');
    expect(output).toContain('observed threshold output tokens:');
    expect(output).toContain('observed threshold total tokens:');
    expect(output).toContain('model=gpt-5.6-sol');
    expect(output).toContain('model=claude-sonnet-5');
    expect(output).toContain('instruction=riya.as3a.');
    // No value, no prefix, no length -- a length narrows a key.
    expect(output).not.toContain('sk-');
  }, 30_000);
});

describe('EXECUTE requires somewhere to put the evidence', () => {
  it('refuses --execute with both opt-ins and no --artifacts, before any network', async () => {
    // A paid run whose candidates live only in memory is the run nobody can review: the process
    // exits, the money is spent, and there is nothing to look at. The refusal happens before the
    // credential read and before an SDK is constructed, so this spec cannot itself spend anything --
    // which is why it is safe to run it with the environment fully armed.
    const path = await planFile();

    const { code, output } = await run(['--plan', path, '--execute'], {
      ...WITH_CREDENTIALS,
      [RIYA_AS3_EXECUTE_ENV]: 'true',
    });

    expect(code).toBe(RIYA_AS3_EXIT_RUNNER_FAILURE);
    expect(output).toContain('FAILED: artifact-destination-required');
    // Nothing was attempted. Checked LINE-wise, because `ceiling provider requests:` is printed by
    // the summary and a substring test would pass for the wrong reason.
    expect(
      output.split(String.fromCharCode(10)).some((line) => line.startsWith('provider requests:')),
    ).toBe(false);
  }, 30_000);

  it('allows a dry run with no --artifacts, because it produces nothing to keep', async () => {
    const path = await planFile();

    const { code, output } = await run(['--plan', path], WITH_CREDENTIALS);

    expect(code).toBe(RIYA_AS3_EXIT_OK);
    expect(output).toContain('provider requests: 0');
  }, 30_000);

  it('says so in the usage line', async () => {
    const { output } = await run([], WITH_CREDENTIALS);

    expect(output).toContain('--execute REQUIRES --artifacts');
  });
});

describe('the CLI separates a runner failure from a rejected candidate', () => {
  it('exits non-zero for an invalid plan, with a closed code and no provider text', async () => {
    const path = await planFile({ planRef: 'incomplete' });

    const { code, output } = await run(['--plan', path], WITH_CREDENTIALS);

    expect(code).toBe(RIYA_AS3_EXIT_RUNNER_FAILURE);
    expect(output).toContain('FAILED: invalid-pilot-plan');
  }, 30_000);

  it('exits with a usage code when no plan is given', async () => {
    const { code, output } = await run([], WITH_CREDENTIALS);

    expect(code).toBe(RIYA_AS3_EXIT_USAGE);
    expect(output).toContain('usage:');
  });

  it('treats an unknown flag as a usage error rather than ignoring it', async () => {
    // A silently ignored flag is how somebody believes they passed `--execute` when they did not --
    // or, worse, believes they did not.
    const { code } = await run(['--plan', 'x', '--yolo'], WITH_CREDENTIALS);

    expect(code).toBe(RIYA_AS3_EXIT_USAGE);
  });
});

describe('argument parsing', () => {
  it('reads the plan, the artifact directory and both opt-in flags', () => {
    const args = parseRiyaSyntheticCliArgs([
      '--plan',
      'p.json',
      '--artifacts',
      '.artifacts/riya',
      '--execute',
      '--allow-overwrite',
    ]);

    expect(args).toStrictEqual({
      planPath: 'p.json',
      artifactDirectory: '.artifacts/riya',
      execute: true,
      allowOverwrite: true,
    });
  });

  it('defaults both flags to off', () => {
    expect(parseRiyaSyntheticCliArgs(['--plan', 'p.json'])).toStrictEqual({
      planPath: 'p.json',
      execute: false,
      allowOverwrite: false,
    });
  });
});
