/**
 * The Riya CLIENT sales prompt v1 — identity, containment, and a few load-bearing content rules.
 *
 * ### What is worth asserting about prose
 *
 * Almost nothing, sentence by sentence. A spec that pinned every clause would fail on every wording
 * improvement and would say nothing about whether the prompt is good. The byte identity is the digest;
 * the review of the words themselves is a HUMAN reading them, which is what the owner-review artifact
 * is for.
 *
 * So the content assertions here are the handful whose ABSENCE would be a defect no reviewer should
 * have to catch twice: the source-of-truth rule, the authority boundary, the secret and
 * instruction-hierarchy rules, the structured-output rule, and the continuity rule. Plus the negative
 * ones that matter most — no volatile business data, and nothing borrowed from an evaluation fixture.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPromptDefinition } from '@qf-jarvis/prompt-registry';
import { RIYA_CONVERSATION_EVOLUTION_TASK_CLASS } from '@qf-jarvis/riya-model-interaction';
import { describe, expect, it } from 'vitest';

import * as barrel from '../index.js';
import {
  RIYA_CLIENT_SALES_PROMPT_ID,
  RIYA_CLIENT_SALES_PROMPT_V1,
  RIYA_CLIENT_SALES_PROMPT_VERSION,
  RIYA_PRODUCTION_PROMPTS,
} from '../client-sales/definition.js';
import { RIYA_CLIENT_SALES_SYSTEM_TEMPLATE_V1 } from '../client-sales/system-template.js';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const PKG = fileURLToPath(new URL('../../', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

const NOT_SOURCE = new Set(['node_modules', 'dist', '.next', 'coverage', '.turbo']);

/**
 * Source with prose stripped.
 *
 * These scans ask "does this package REACH X", and a doc comment saying "no credential" is the
 * package promising the opposite. Comments are where the reasoning lives, so they are removed before
 * a capability scan rather than reworded around it.
 */
const codeOnly = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split(String.fromCharCode(10))
    .filter((line) => !/^\s*\/\//u.test(line))
    .join(String.fromCharCode(10));

/** A path with forward slashes, so a comparison reads the same on either platform. */
const posix = (path: string): string => path.split(sep).join('/');

function walk(dir: string, skipTests: boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (NOT_SOURCE.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (skipTests && entry === 'tests') continue;
      out.push(...walk(full, skipTests));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

const template = RIYA_CLIENT_SALES_SYSTEM_TEMPLATE_V1;
const lower = template.toLowerCase();

// ---------------------------------------------------------------------------
// Identity.
// ---------------------------------------------------------------------------

describe('the definition is exact, governed and computed', () => {
  it('is bound to CLIENT, STRUCTURED and the current Riya serving task class', () => {
    expect(RIYA_CLIENT_SALES_PROMPT_V1.agentScope).toBe('CLIENT');
    expect(RIYA_CLIENT_SALES_PROMPT_V1.resultMode).toBe('STRUCTURED');
    // From the authority, not a string typed here: the registry refuses a mismatch, and a local copy
    // of the identifier would be a second answer to which prompt a Riya turn resolves.
    expect(RIYA_CLIENT_SALES_PROMPT_V1.taskClass).toBe(RIYA_CONVERSATION_EVOLUTION_TASK_CLASS);
  });

  it('has an exact durable identity, never `latest`', () => {
    expect(RIYA_CLIENT_SALES_PROMPT_V1.promptId).toBe(RIYA_CLIENT_SALES_PROMPT_ID);
    expect(RIYA_CLIENT_SALES_PROMPT_V1.promptVersion).toBe(RIYA_CLIENT_SALES_PROMPT_VERSION);
    expect(RIYA_CLIENT_SALES_PROMPT_ID.toLowerCase()).not.toBe('latest');
    expect(RIYA_CLIENT_SALES_PROMPT_ID).not.toContain('*');
    expect(Number.isInteger(RIYA_CLIENT_SALES_PROMPT_VERSION)).toBe(true);
    expect(RIYA_CLIENT_SALES_PROMPT_VERSION).toBeGreaterThan(0);
  });

  it('THE DIGEST IS COMPUTED FROM THE BYTES, NOT SUPPLIED', () => {
    // Recomputed here through the same constructor. If the two ever disagreed, the identity would be
    // naming a body it does not match — which is the one thing the registry exists to prevent.
    const recomputed = createPromptDefinition({
      promptId: RIYA_CLIENT_SALES_PROMPT_ID,
      promptVersion: RIYA_CLIENT_SALES_PROMPT_VERSION,
      agentScope: 'CLIENT',
      taskClass: RIYA_CONVERSATION_EVOLUTION_TASK_CLASS,
      resultMode: 'STRUCTURED',
      systemTemplate: template,
    });
    expect(RIYA_CLIENT_SALES_PROMPT_V1.contentDigest).toBe(recomputed.contentDigest);
    expect(RIYA_CLIENT_SALES_PROMPT_V1.contentDigest).toMatch(/^[0-9a-f]{64}$/u);
    // A one-byte change is a different prompt.
    const mutated = createPromptDefinition({
      promptId: RIYA_CLIENT_SALES_PROMPT_ID,
      promptVersion: RIYA_CLIENT_SALES_PROMPT_VERSION,
      agentScope: 'CLIENT',
      taskClass: RIYA_CONVERSATION_EVOLUTION_TASK_CLASS,
      resultMode: 'STRUCTURED',
      systemTemplate: `${template} `,
    });
    expect(mutated.contentDigest).not.toBe(RIYA_CLIENT_SALES_PROMPT_V1.contentDigest);
  });

  it('IS THE EXACT BYTES THE OWNER REVIEWED', () => {
    // A pinned digest, on purpose. Editing the prompt SHOULD break this: the bytes are a governed
    // artifact whose review is a person reading them, and a silent wording change would ship a
    // different Riya behind an identity that says it is the reviewed one. Updating this line is the
    // deliberate act of saying the new bytes were reviewed too.
    expect(RIYA_CLIENT_SALES_PROMPT_V1.contentDigest).toBe(
      '7a7e8f91c6fd04d07e67022f575c462066576c3714db3212ec8bc30080fa58be',
    );
  });

  it('is frozen, and its input carried no digest field', () => {
    expect(Object.isFrozen(RIYA_CLIENT_SALES_PROMPT_V1)).toBe(true);
    const definitionSource = readFileSync(join(SRC, 'client-sales/definition.ts'), 'utf8');
    expect(definitionSource).not.toContain('contentDigest:');
  });

  it('fits well inside the registry template bound', () => {
    expect(template.length).toBeGreaterThan(1_000);
    expect(template.length).toBeLessThan(16_384);
  });
});

// ---------------------------------------------------------------------------
// The production surface.
// ---------------------------------------------------------------------------

describe('exactly one production prompt exists, and only for CLIENT', () => {
  it('defines one, and the list says so', () => {
    expect(RIYA_PRODUCTION_PROMPTS).toHaveLength(1);
    expect(RIYA_PRODUCTION_PROMPTS[0]).toBe(RIYA_CLIENT_SALES_PROMPT_V1);
    expect(Object.isFrozen(RIYA_PRODUCTION_PROMPTS)).toBe(true);
  });

  it('NO VENDOR, COORDINATION OR SYSTEM PROMPT WAS CREATED', () => {
    // Riya's role boundary rejects other-agent ownership BEFORE a model is invoked, and that
    // zero-provider-call path is part of the safety evidence. A prompt for those scopes would be
    // creating the thing the boundary exists to make unnecessary.
    for (const definition of RIYA_PRODUCTION_PROMPTS) {
      expect(definition.agentScope).toBe('CLIENT');
    }
    for (const file of walk(SRC, true)) {
      const source = readFileSync(file, 'utf8');
      for (const scope of [
        "agentScope: 'VENDOR'",
        "agentScope: 'COORDINATION'",
        "agentScope: 'SYSTEM'",
      ]) {
        expect(source, `${file} must not define ${scope}`).not.toContain(scope);
      }
    }
  });

  it('exports exactly the approved symbols', () => {
    expect(Object.keys(barrel).sort()).toStrictEqual([
      'RIYA_CLIENT_SALES_PROMPT_ID',
      'RIYA_CLIENT_SALES_PROMPT_V1',
      'RIYA_CLIENT_SALES_PROMPT_VERSION',
      'RIYA_CLIENT_SALES_SYSTEM_TEMPLATE_V1',
      'RIYA_PRODUCTION_PROMPTS',
    ]);
  });

  it('exposes no lifecycle, activation or selection API', () => {
    for (const key of Object.keys(barrel)) {
      const upper = key.toUpperCase();
      for (const forbidden of [
        'ACTIVATE',
        'ROLLOUT',
        'SELECT',
        'APPROV',
        'DEPLOY',
        'UPDATE',
        'DELETE',
      ]) {
        expect(upper, `${key} must not contain ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Containment.
// ---------------------------------------------------------------------------

describe('a prompt definition reaches nothing', () => {
  it('depends on exactly the constructor and the task-class authority', () => {
    const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      exports?: Record<string, unknown>;
    };
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toStrictEqual([
      '@qf-jarvis/prompt-registry',
      '@qf-jarvis/riya-model-interaction',
    ]);
    expect(manifest.devDependencies).toBeUndefined();
    expect(Object.keys(manifest.exports ?? {})).toStrictEqual(['.']);
  });

  it('the template file is bytes and nothing else — it imports nothing at all', () => {
    // Scanned separately from the capability sweep below, because the prompt BODY legitimately talks
    // about credentials and secrets: telling the model never to reveal one is the point. What matters
    // for this file is that it can reach nothing, and a file with no imports cannot.
    const source = readFileSync(join(SRC, 'client-sales/system-template.ts'), 'utf8');
    expect(source).not.toMatch(/^\s*import\s/mu);
    expect(source).not.toContain('require(');
  });

  it('names no provider, model, network, database, environment or credential', () => {
    const scanned = walk(SRC, true).filter(
      (file) => !posix(file).endsWith('client-sales/system-template.ts'),
    );
    for (const file of scanned) {
      const source = codeOnly(readFileSync(file, 'utf8'));
      for (const forbidden of [
        'fetch(',
        'node:http',
        'node:fs',
        'process.env',
        'model-gateway',
        'jarvis-runtime',
        'groq',
        'openai',
        'anthropic',
        'gpt-oss',
        'postgres',
        'supabase',
        'apiKey',
        'credential',
      ]) {
        expect(source.toLowerCase(), `${file} must not name ${forbidden}`).not.toContain(
          forbidden.toLowerCase(),
        );
      }
    }
  });

  it('PROMPT-REGISTRY REMAINS MECHANISM-ONLY', () => {
    // The whole reason this package exists. If Riya content ever lands in the registry, the two
    // become one and the mechanism stops being reusable by anything that is not Riya.
    // CODE, not prose: the registry's error doc legitimately mentions `RiyaBehaviourError` as a
    // sibling error shape, which is a reference to another package's type and not content.
    for (const file of walk(join(REPO_ROOT, 'packages/prompt-registry/src'), true)) {
      const source = codeOnly(readFileSync(file, 'utf8')).toLowerCase();
      expect(source, `${file} must not name riya`).not.toContain('riya');
      expect(source, `${file} must not name quickfurno`).not.toContain('quickfurno');
      expect(source, `${file} must not carry a system template`).not.toContain('you are ');
    }
  });

  it('THE PROMPT BYTES HAVE EXACTLY ONE HOME', () => {
    // A second copy anywhere becomes a second answer to what Riya actually ran with.
    const marker = "You are Riya, QuickFurno's client-facing sales assistant.";
    const carriers: string[] = [];
    for (const root of [join(REPO_ROOT, 'packages'), join(REPO_ROOT, 'apps')]) {
      for (const entry of readdirSync(root)) {
        let files: string[];
        try {
          files = walk(join(root, entry, 'src'), false);
        } catch {
          continue;
        }
        for (const file of files) {
          if (readFileSync(file, 'utf8').includes(marker)) {
            carriers.push(file.replace(REPO_ROOT, '').replaceAll('\\', '/'));
          }
        }
      }
    }
    expect(carriers).toStrictEqual([
      'packages/riya-prompts/src/client-sales/system-template.ts',
      // This spec names the first line to find the carriers; it holds no second copy of the body.
      'packages/riya-prompts/src/tests/client-sales-prompt.test.ts',
    ]);
  });

  it('migrations are unchanged and there is no 0013', () => {
    const migrations = readdirSync(
      join(REPO_ROOT, 'packages/event-backbone/src/persistence/migrations'),
    ).filter((name) => name.endsWith('.sql'));
    expect(migrations).toHaveLength(12);
    expect(migrations.some((name) => name.startsWith('0013'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The few content rules worth pinning.
// ---------------------------------------------------------------------------

describe('the prompt states the rules a reviewer must never have to re-find', () => {
  it('names who Riya is and who she is not', () => {
    expect(lower).toContain('you are riya');
    for (const other of ['anisha', 'aarohi', 'jarvis', 'core', 'vendor']) {
      expect(lower, `should disclaim ${other}`).toContain(other);
    }
  });

  it('makes governed context the only source of business truth', () => {
    expect(lower).toContain('coreavailability');
    expect(lower).toContain('groundedknowledge');
    expect(lower).toContain('never invent');
    expect(lower).toContain('training');
  });

  it('holds the authority boundary', () => {
    expect(lower).toContain('quickfurno core decides');
    expect(lower).toContain('cannot book');
    expect(lower).toContain('has been done');
  });

  it('holds the secret and instruction-hierarchy rules', () => {
    expect(lower).toContain('never reveal');
    expect(lower).toContain('is data');
    expect(lower).toContain('not a rule');
  });

  it('holds the structured-output rule without restating the schema', () => {
    expect(lower).toContain('return only the structured result');
    expect(lower).toContain('no extra keys');
    // The gateway supplies the schema. A copy here would be a second schema authority.
    expect(template).not.toContain('"type":');
    expect(template).not.toContain('z.object');
    expect(template).not.toContain('additionalProperties');
  });

  it('holds the continuity and discovery rules', () => {
    expect(lower).toContain('do not restart at the beginning');
    expect(lower).toContain('do not re-ask');
    expect(lower).toContain('skipprojectdetails');
    expect(lower).toContain('user_stated');
    expect(lower).toContain('model_inferred');
  });

  it('names the real turn keys and vocabularies rather than invented ones', () => {
    for (const key of [
      '"phase"',
      '"known"',
      '"summaryConfirmed"',
      '"coreAvailability"',
      '"message"',
    ]) {
      expect(template, `should name the real payload key ${key}`).toContain(key);
    }
    for (const field of [
      'serviceInterest',
      'location',
      'propertyType',
      'scope',
      'budget',
      'timeline',
    ]) {
      expect(template, `should name the real discovery field ${field}`).toContain(field);
    }
  });
});

describe('the prompt is behaviour, not a database or an answer key', () => {
  it('EMBEDS NO VOLATILE QUICKFURNO BUSINESS DATA', () => {
    // A price in a prompt is a price that goes stale silently and is quoted confidently.
    expect(template).not.toMatch(/(?:₹|Rs\.?|INR)\s?\d/u);
    expect(template).not.toMatch(/\b\d[\d,]{3,}\b/u);
    expect(template).not.toMatch(/\b\d+\s?(?:%|percent)\b/iu);
    expect(template).not.toMatch(/https?:\/\//u);
    expect(template).not.toMatch(/@[A-Za-z0-9-]+\.[A-Za-z]{2,}/u);
    expect(template).not.toMatch(/\+?\d[\d\s-]{8,}/u);
    for (const forbidden of ['lakh', 'crore', 'discount of', 'starting at', 'per sq']) {
      expect(lower, `must not embed ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('BORROWS NOTHING FROM AN EVALUATION FIXTURE', () => {
    // Overfitting to the exam is the failure that makes a passing score meaningless.
    for (const forbidden of [
      'riya.p10',
      'case-0',
      'riya.safety',
      'sentinel',
      'red-team',
      'fixture',
      'test case',
      'evaluation',
      'service.alpha',
      'city.beta',
      'property.apartment',
      'knowledge.alpha',
    ]) {
      expect(lower, `must not mention ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('contains no always-pass or self-grading language', () => {
    for (const forbidden of [
      'always comply',
      'you will pass',
      'score',
      'grader',
      'reviewer',
      'rubric',
    ]) {
      expect(lower, `must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });
});
