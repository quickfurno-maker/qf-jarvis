/**
 * Containment: this package is offline, and nothing that serves a customer can reach it (§25).
 *
 * ### The direction is the whole claim
 *
 * An offline CLI may reach these adapters; these adapters may reach AS2's port. Nothing else may
 * reach either. A serving path that could reach the provider adapters is a path by which a live
 * conversation could become training data, or by which a corpus build could acquire a production
 * credential — and the arrow has to be one-way as a FACT rather than as an intention.
 *
 * ### The corpus comes from git, not from a filesystem walk
 *
 * `git ls-files` is the source of truth for what is production source. Trackedness is the honest
 * discriminator: a walk that skipped by filename would open a bypass, and a walk that did not skip at
 * all would race whatever transient file another suite happened to be holding. This is the
 * convention the repository settled on after the lint-probe ENOENT race, and it stays settled.
 */
import { execFile as execFileCallback } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import * as barrel from '../index.js';

const execFile = promisify(execFileCallback);
const REPO_DIR = fileURLToPath(new URL('../../../../', import.meta.url));
const PKG_DIR = fileURLToPath(new URL('../../', import.meta.url));

const SPECIFIER = '@qf-jarvis/riya-ai-synthetic-provider-adapters';

interface SourceFile {
  readonly relative: string;
  readonly code: string;
}

let corpus: Promise<readonly SourceFile[]> | undefined;

/** Every tracked, non-test `.ts` file under `packages/` and `apps/`. */
async function trackedSources(): Promise<readonly SourceFile[]> {
  corpus ??= (async () => {
    const { stdout } = await execFile('git', ['ls-files', '--', 'packages', 'apps'], {
      cwd: REPO_DIR,
      maxBuffer: 32 * 1024 * 1024,
    });
    const paths = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.endsWith('.ts') || line.endsWith('.tsx'))
      .filter((line) => !line.includes('/tests/') && !line.includes('.test.'));

    // No blanket try/catch: a TRACKED file that cannot be read is a real problem, and swallowing it
    // would quietly shrink the corpus this suite reasons about.
    return Promise.all(
      paths.map(async (relative) => ({
        relative,
        code: await readFile(join(REPO_DIR, relative), 'utf8'),
      })),
    );
  })();
  return corpus;
}

/** This package's own production source. */
async function packageSources(): Promise<readonly SourceFile[]> {
  const all = await trackedSources();
  return all.filter((file) =>
    file.relative.startsWith('packages/riya-ai-synthetic-provider-adapters/src/'),
  );
}

describe('nothing that serves a customer can import the provider adapters', () => {
  it('is imported by no app', async () => {
    const importers = (await trackedSources())
      .filter((file) => file.relative.startsWith('apps/') && file.code.includes(SPECIFIER))
      .map((file) => file.relative);

    expect(importers).toStrictEqual([]);
  });

  it('is imported by no runtime, serving, WhatsApp or composition package', async () => {
    // Named explicitly rather than inferred, so adding a runtime does not silently widen the claim.
    const forbidden = [
      'packages/jarvis-runtime/',
      'packages/agent-runtime/',
      'packages/model-gateway/',
      'packages/model-gateway-composition/',
      'packages/model-reply-adapter/',
      'packages/riya-model-interaction/',
      'packages/riya-web-conversation-service/',
      'packages/communication-request-runtime/',
      'packages/communication-lifecycle-runtime/',
      'packages/execution-dispatch-runtime/',
      'packages/execution-dispatch-composition/',
      'packages/recommendation-runtime/',
      'packages/approval-runtime/',
      'packages/core-riya-intake/',
    ];
    const importers = (await trackedSources())
      .filter(
        (file) =>
          forbidden.some((prefix) => file.relative.startsWith(prefix)) &&
          file.code.includes(SPECIFIER),
      )
      .map((file) => file.relative);

    expect(importers).toStrictEqual([]);
  });

  it('is imported by NOTHING outside itself', async () => {
    // The strongest form, and the one that survives a new package being added.
    const importers = (await trackedSources())
      .filter(
        (file) =>
          !file.relative.startsWith('packages/riya-ai-synthetic-provider-adapters/') &&
          file.code.includes(SPECIFIER),
      )
      .map((file) => file.relative);

    expect(importers).toStrictEqual([]);
  });
});

describe('the AS2 core and the dataset gained no provider dependency', () => {
  it.each([
    ['packages/riya-ai-synthetic-generation/'],
    ['packages/riya-intelligence-dataset/'],
    ['packages/riya-quality-evaluation/'],
    ['packages/riya-conversation-continuity/'],
  ])('keeps %s free of an OpenAI or Anthropic SDK', async (prefix) => {
    // AS2 is provider-INDEPENDENT and must stay so. If a provider SDK ever appears there, the port
    // has stopped being a seam and the whole arrangement is decorative.
    const offenders = (await trackedSources())
      .filter(
        (file) =>
          file.relative.startsWith(prefix) &&
          (file.code.includes("from 'openai'") ||
            file.code.includes("from '@anthropic-ai/sdk'") ||
            file.code.includes(SPECIFIER)),
      )
      .map((file) => file.relative);

    expect(offenders).toStrictEqual([]);
  });

  it('confines every provider SDK import to the two binding files', async () => {
    // Everything else in this package works against the transport seam, which is why every rule the
    // adapters enforce is testable with no network and no credential.
    const importers = (await packageSources())
      .filter(
        (file) =>
          file.code.includes("from 'openai'") ||
          file.code.includes("from '@anthropic-ai/sdk'") ||
          file.code.includes("import('openai')") ||
          file.code.includes("import('@anthropic-ai/sdk')"),
      )
      .map((file) =>
        file.relative.replace('packages/riya-ai-synthetic-provider-adapters/src/', ''),
      );

    expect([...importers].sort()).toStrictEqual([
      'adapters/anthropic-sdk-transport.ts',
      'adapters/openai-sdk-transport.ts',
      // The CLI imports both DYNAMICALLY, and only after the run is already authorized to spend -- a
      // dry run never evaluates either module.
      'cli/pilot.ts',
    ]);
  });
});

describe('the package holds no credential and can print none', () => {
  it('contains no credential literal of any shape', async () => {
    for (const file of await packageSources()) {
      expect(/\bsk-[A-Za-z0-9_-]{8,}/u.test(file.code), file.relative).toBe(false);
      expect(/\bBearer\s+[A-Za-z0-9._-]{8,}/u.test(file.code), file.relative).toBe(false);
      expect(/\beyJ[A-Za-z0-9_-]{12,}/u.test(file.code), file.relative).toBe(false);
    }
  });

  it('reads the environment in ONE module, and the CLI entry point', async () => {
    // Everything else takes an injected environment, so a spec never touches the real one and no
    // module can quietly acquire a credential of its own.
    const readers = (await packageSources())
      .filter((file) => file.code.includes('process.env'))
      .map((file) =>
        file.relative.replace('packages/riya-ai-synthetic-provider-adapters/src/', ''),
      );

    expect([...readers].sort()).toStrictEqual(['cli/bin.ts']);
  });

  it('never calls console', async () => {
    for (const file of await packageSources()) {
      expect(file.code, file.relative).not.toContain('console.');
    }
  });

  it('imports no protected fixture, golden corpus or testing subpath in production source', async () => {
    // The protected exam reaches the AS1 VALIDATOR, as a parameter, after a candidate exists. It has
    // no path into a prompt, an adapter or a transport, and this is what keeps it that way.
    for (const file of await packageSources()) {
      for (const forbidden of [
        '/testing',
        '/gold-v1',
        'syntheticProtectedIndex',
        'HUMAN_AUTHORED',
        'createProtectedTextIndex',
      ]) {
        expect(file.code, `${file.relative} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('adds no migration and writes no database', async () => {
    for (const file of await packageSources()) {
      for (const forbidden of [
        'node:pg',
        "from 'pg'",
        'migration',
        'CREATE TABLE',
        'event-backbone',
      ]) {
        expect(
          file.code.toLowerCase(),
          `${file.relative} must not name ${forbidden}`,
        ).not.toContain(forbidden.toLowerCase());
      }
    }
  });
});

describe('the public surface is small and offline', () => {
  it('exposes exactly one subpath and the reviewed dependencies', async () => {
    const manifest = JSON.parse(await readFile(join(PKG_DIR, 'package.json'), 'utf8')) as {
      exports?: Record<string, unknown>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(Object.keys(manifest.exports ?? {})).toStrictEqual(['.']);
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toStrictEqual([
      '@anthropic-ai/sdk',
      '@qf-jarvis/riya-ai-synthetic-generation',
      '@qf-jarvis/riya-conversation-continuity',
      '@qf-jarvis/riya-intelligence-dataset',
      'openai',
      'zod',
    ]);
    expect(manifest.devDependencies).toBeUndefined();
  });

  it('exports no transport binding detail that would let a caller smuggle a client in', () => {
    // The bindings ARE exported -- a composition root needs them -- but nothing that would let a
    // caller replace the projection, the instruction text or the schema registry.
    for (const forbidden of [
      'projectRiyaSyntheticRoleInput_unsafe',
      'RIYA_SYNTHETIC_INSTRUCTION_TEXTS',
      'readEnvironment',
    ]) {
      expect(Object.keys(barrel), forbidden).not.toContain(forbidden);
    }
  });

  it('exports nothing that reads as a corpus, a release or a training surface', () => {
    for (const key of Object.keys(barrel)) {
      const upper = key.toUpperCase();
      for (const forbidden of ['CORPUS', 'RELEASE', 'TRAIN', 'FINETUNE', 'LORA', 'CHECKPOINT']) {
        expect(upper, `${key} must not contain ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('names no training framework, optimizer or checkpoint anywhere', async () => {
    for (const file of await packageSources()) {
      for (const forbidden of [
        'pytorch',
        'qlora',
        'fine-tune',
        'finetune',
        'optimizer',
        'checkpoint',
      ]) {
        expect(
          file.code.toLowerCase(),
          `${file.relative} must not name ${forbidden}`,
        ).not.toContain(forbidden);
      }
    }
  });

  it('keeps every source file inside this package', async () => {
    // A guard against the corpus filter quietly matching nothing, which would make every assertion
    // above pass for the wrong reason.
    const files = await packageSources();

    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      expect(file.relative.includes(`${sep}..${sep}`)).toBe(false);
    }
  });
});
