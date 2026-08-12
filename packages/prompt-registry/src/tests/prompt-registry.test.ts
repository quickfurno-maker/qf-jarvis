/**
 * QFJ-S3-I-A — the versioned prompt registry foundation (ADR-0072).
 *
 * The property these specs exist to pin down is the one the S3-I Part 0 audit found missing from the
 * runtime: an identity that is BOUND to its exact bytes. So the digest tests matter more than they
 * look — they prove the digest moves with content and stands still for metadata, which is what makes
 * "this version is that text" a checkable claim rather than a convention.
 *
 * Every prompt string here is clearly synthetic. This package registers no production instruction.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PROMPT_REGISTRY_ERROR_CODES, PromptRegistryError } from '../contracts/errors.js';
import {
  PROMPT_AGENT_SCOPES_FROZEN,
  PROMPT_REGISTRY_VERSION,
  PROMPT_RESULT_MODES_FROZEN,
  createPromptDefinition,
} from '../contracts/prompt-definition.js';
import type {
  PromptAgentScope,
  PromptDefinition,
  PromptDefinitionInput,
  PromptResultMode,
} from '../contracts/prompt-definition.js';
import { createPromptRegistry } from '../contracts/prompt-registry.js';
import type { PromptResolutionRequest } from '../contracts/prompt-registry.js';

const TEMPLATE = 'Synthetic CLIENT prompt for registry tests.';

function input(over: Partial<PromptDefinitionInput> = {}): PromptDefinitionInput {
  return {
    promptId: 'reply.client',
    promptVersion: 1,
    agentScope: 'CLIENT',
    taskClass: 'RESPONSE_GENERATION',
    resultMode: 'STRUCTURED',
    systemTemplate: TEMPLATE,
    ...over,
  };
}

const definition = (over: Partial<PromptDefinitionInput> = {}): PromptDefinition =>
  createPromptDefinition(input(over));

function request(over: Partial<PromptResolutionRequest> = {}): PromptResolutionRequest {
  return {
    promptId: 'reply.client',
    promptVersion: 1,
    agentScope: 'CLIENT',
    taskClass: 'RESPONSE_GENERATION',
    resultMode: 'STRUCTURED',
    ...over,
  };
}

const asDefinition = (value: unknown): PromptDefinition => value as PromptDefinition;

/** A plain mutable object with the exact materialized shape the constructor produces. */
function materialized(over: Record<string, unknown> = {}): Record<string, unknown> {
  const built = definition();
  return { ...built, ...over };
}

// ---------------------------------------------------------------------------
// A. Definition validation.
// ---------------------------------------------------------------------------

describe('(A) prompt definition validation', () => {
  it('accepts every agent scope and every result mode', () => {
    expect([...PROMPT_AGENT_SCOPES_FROZEN]).toEqual(['CLIENT', 'VENDOR', 'COORDINATION', 'SYSTEM']);
    expect([...PROMPT_RESULT_MODES_FROZEN]).toEqual(['STRUCTURED', 'TEXT']);
    for (const agentScope of PROMPT_AGENT_SCOPES_FROZEN) {
      expect(definition({ agentScope }).agentScope).toBe(agentScope);
    }
    for (const resultMode of PROMPT_RESULT_MODES_FROZEN) {
      expect(definition({ resultMode }).resultMode).toBe(resultMode);
    }
  });

  it('rejects HUMAN and any unknown scope or result mode', () => {
    for (const bad of ['HUMAN', 'JARVIS', 'client', '']) {
      expect(() => definition({ agentScope: bad as PromptAgentScope })).toThrow(
        PromptRegistryError,
      );
    }
    for (const bad of ['JSON', 'CHAT', 'FUNCTION', 'TOOLS', 'structured']) {
      expect(() => definition({ resultMode: bad as PromptResultMode })).toThrow(
        PromptRegistryError,
      );
    }
  });

  it('bounds promptId and rejects wildcard and latest', () => {
    expect(definition({ promptId: 'a' }).promptId).toBe('a');
    expect(definition({ promptId: 'p'.repeat(128) }).promptId).toHaveLength(128);
    for (const bad of [
      '',
      'p'.repeat(129),
      'has space',
      'has/slash',
      'star*',
      '*',
      'latest',
      'LATEST',
      'LaTeSt',
    ]) {
      expect(() => definition({ promptId: bad })).toThrow(PromptRegistryError);
    }
    // `latest` is refused only as the whole token; a legitimate id containing it survives.
    expect(definition({ promptId: 'reply.latest-stable' }).promptId).toBe('reply.latest-stable');
  });

  it('bounds promptVersion to an integer 1..1_000_000', () => {
    expect(definition({ promptVersion: 1 }).promptVersion).toBe(1);
    expect(definition({ promptVersion: 1_000_000 }).promptVersion).toBe(1_000_000);
    for (const bad of [0, -1, 1_000_001, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => definition({ promptVersion: bad })).toThrow(PromptRegistryError);
    }
  });

  it('applies the same exact-identifier rule to taskClass', () => {
    expect(definition({ taskClass: 'RESPONSE_GENERATION' }).taskClass).toBe('RESPONSE_GENERATION');
    for (const bad of ['', 't'.repeat(129), 'has space', 'has/slash', '*', 'latest']) {
      expect(() => definition({ taskClass: bad })).toThrow(PromptRegistryError);
    }
  });

  it('bounds the system template, permits newlines, and rejects NUL', () => {
    expect(definition({ systemTemplate: 'x' }).systemTemplate).toBe('x');
    expect(definition({ systemTemplate: 'x'.repeat(16_384) }).systemTemplate).toHaveLength(16_384);
    const multiline = ['Synthetic line one.', 'Synthetic line two.'].join(String.fromCharCode(10));
    expect(definition({ systemTemplate: multiline }).systemTemplate).toBe(multiline);
    for (const bad of ['', 'x'.repeat(16_385), `bad${String.fromCharCode(0)}nul`]) {
      expect(() => definition({ systemTemplate: bad })).toThrow(PromptRegistryError);
    }
  });

  it('rejects an unknown input field, including a caller-supplied digest or registry version', () => {
    const extras: readonly Record<string, unknown>[] = [
      { contentDigest: 'a'.repeat(64) },
      { registryVersion: 1 },
      { status: 'ACTIVE' },
      { approvalStatus: 'APPROVED' },
      { evaluationRef: 'evref-1' },
      { variables: {} },
      { metadata: {} },
    ];
    for (const extra of extras) {
      // The spread already widens the type; no assertion is needed, and the strict schema is what
      // rejects the extra key at runtime.
      expect(() => createPromptDefinition({ ...input(), ...extra })).toThrow(PromptRegistryError);
    }
  });

  it('rejects null, an array and a primitive input', () => {
    for (const bad of [null, [], 'definition', 42, undefined]) {
      expect(() => createPromptDefinition(bad as unknown as PromptDefinitionInput)).toThrow(
        PromptRegistryError,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// B. Digest — content-bound, metadata-independent.
// ---------------------------------------------------------------------------

describe('(B) the content digest binds identity to exact bytes', () => {
  it('is the lowercase 64-hex SHA-256 of the exact UTF-8 template', () => {
    const built = definition();
    expect(built.contentDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(built.contentDigest).toBe(createHash('sha256').update(TEMPLATE, 'utf8').digest('hex'));
  });

  it('is deterministic for identical content', () => {
    expect(definition().contentDigest).toBe(definition().contentDigest);
  });

  it('changes for ANY content change, including whitespace and line endings', () => {
    const base = definition().contentDigest;
    const variants = [
      `${TEMPLATE}!`,
      TEMPLATE.replace('Synthetic', 'synthetic'),
      `${TEMPLATE} `,
      ` ${TEMPLATE}`,
      `${TEMPLATE}${String.fromCharCode(10)}`,
      `${TEMPLATE}${String.fromCharCode(13, 10)}`,
      'Synthetic CLIENT prompt for registry tests .',
    ];
    for (const systemTemplate of variants) {
      expect(definition({ systemTemplate }).contentDigest).not.toBe(base);
    }
    // CRLF and LF are distinct content, not the same text formatted differently.
    const lf = definition({ systemTemplate: `a${String.fromCharCode(10)}b` }).contentDigest;
    const crlf = definition({ systemTemplate: `a${String.fromCharCode(13, 10)}b` }).contentDigest;
    expect(lf).not.toBe(crlf);
  });

  it('is deterministic for non-ASCII content under UTF-8', () => {
    const unicode = 'Synthetic prompt — é 日本語 🙂';
    expect(definition({ systemTemplate: unicode }).contentDigest).toBe(
      createHash('sha256').update(unicode, 'utf8').digest('hex'),
    );
  });

  it('does NOT change when only metadata changes — the digest is content, not identity', () => {
    const base = definition().contentDigest;
    expect(definition({ promptId: 'reply.other' }).contentDigest).toBe(base);
    expect(definition({ promptVersion: 77 }).contentDigest).toBe(base);
    expect(definition({ agentScope: 'VENDOR' }).contentDigest).toBe(base);
    expect(definition({ taskClass: 'OTHER_TASK' }).contentDigest).toBe(base);
    expect(definition({ resultMode: 'TEXT' }).contentDigest).toBe(base);
  });
});

// ---------------------------------------------------------------------------
// C. Definition immutability.
// ---------------------------------------------------------------------------

describe('(C) a definition is frozen and does not mutate its input', () => {
  it('freezes the result and stamps registryVersion 1', () => {
    const built = definition();
    expect(Object.isFrozen(built)).toBe(true);
    expect(built.registryVersion).toBe(1);
    expect(built.registryVersion).toBe(PROMPT_REGISTRY_VERSION);
    expect(() => {
      (built as unknown as Record<string, unknown>)['promptId'] = 'hacked';
    }).toThrow();
    expect(built.promptId).toBe('reply.client');
  });

  it('leaves the caller input untouched', () => {
    const supplied = input();
    const snapshot = JSON.stringify(supplied);
    createPromptDefinition(supplied);
    expect(JSON.stringify(supplied)).toBe(snapshot);
    expect(Object.isFrozen(supplied)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// D. Registry construction, ordering, canonicalization.
// ---------------------------------------------------------------------------

describe('(D) registry construction', () => {
  it('allows an empty registry — a not-yet-activated foundation is coherent', () => {
    const registry = createPromptRegistry([]);
    expect(registry.definitions).toEqual([]);
    expect(registry.version).toBe(1);
    expect(registry.resolve(request())).toBeUndefined();
  });

  it('accepts one and many definitions', () => {
    expect(createPromptRegistry([definition()]).definitions).toHaveLength(1);
    expect(
      createPromptRegistry([
        definition(),
        definition({ promptVersion: 2 }),
        definition({ promptId: 'reply.vendor', agentScope: 'VENDOR' }),
      ]).definitions,
    ).toHaveLength(3);
  });

  it('orders canonically by promptId then promptVersion, ignoring caller order', () => {
    const listed = [
      definition({ promptId: 'z.prompt', promptVersion: 2 }),
      definition({ promptId: 'a.prompt', promptVersion: 10 }),
      definition({ promptId: 'z.prompt', promptVersion: 1 }),
      definition({ promptId: 'a.prompt', promptVersion: 2 }),
    ];
    const expected = [
      ['a.prompt', 2],
      ['a.prompt', 10],
      ['z.prompt', 1],
      ['z.prompt', 2],
    ];
    const forward = createPromptRegistry(listed);
    const reversed = createPromptRegistry([...listed].reverse());
    for (const registry of [forward, reversed]) {
      expect(registry.definitions.map((d) => [d.promptId, d.promptVersion])).toEqual(expected);
    }
    // Numeric, not lexicographic: 10 must sort after 2.
    expect(forward.definitions[1]?.promptVersion).toBe(10);
  });

  it('freezes the registry, its definitions array and every definition', () => {
    const registry = createPromptRegistry([definition()]);
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.definitions)).toBe(true);
    expect(Object.isFrozen(registry.definitions[0])).toBe(true);
    expect(() => (registry.definitions as unknown as unknown[]).push(definition())).toThrow();
  });

  it('exposes no mutation method of any kind', () => {
    const registry = createPromptRegistry([definition()]) as unknown as Record<string, unknown>;
    for (const method of [
      'register',
      'add',
      'remove',
      'replace',
      'update',
      'activate',
      'retire',
      'reload',
      'refresh',
      'fetch',
      'save',
      'persist',
    ]) {
      expect(registry[method]).toBeUndefined();
    }
    expect(Object.keys(registry).sort()).toEqual(['definitions', 'resolve', 'version']);
  });

  it('returns canonical objects, never the caller-supplied mutable one', () => {
    const forged = materialized();
    expect(Object.isFrozen(forged)).toBe(false);
    const registry = createPromptRegistry([asDefinition(forged)]);
    const stored = registry.definitions[0];
    expect(stored).not.toBe(forged);
    expect(Object.isFrozen(stored)).toBe(true);
    expect(stored).toEqual(definition());
    expect(Object.isFrozen(forged)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// E. Materialized-definition revalidation.
// ---------------------------------------------------------------------------

describe('(E) supplied materialized definitions are revalidated, not trusted', () => {
  it('rejects a wrong registryVersion', () => {
    for (const registryVersion of [0, 2, 999, '1', undefined, null]) {
      expect(() => createPromptRegistry([asDefinition(materialized({ registryVersion }))])).toThrow(
        PromptRegistryError,
      );
    }
  });

  it('rejects a digest that does not match its own template — the forgery case', () => {
    const wrongDigest = createHash('sha256').update('different text', 'utf8').digest('hex');
    expect(() =>
      createPromptRegistry([asDefinition(materialized({ contentDigest: wrongDigest }))]),
    ).toThrow(PromptRegistryError);

    // Equivalently: keep the digest, swap the body. An identity may not name a body it does not match.
    expect(() =>
      createPromptRegistry([
        asDefinition(materialized({ systemTemplate: 'Synthetic replaced body.' })),
      ]),
    ).toThrow(PromptRegistryError);
  });

  it('rejects a malformed digest of any shape', () => {
    for (const bad of ['A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), 'not-a-digest', '', 42]) {
      expect(() =>
        createPromptRegistry([asDefinition(materialized({ contentDigest: bad }))]),
      ).toThrow(PromptRegistryError);
    }
  });

  it('rejects a missing or unknown materialized key', () => {
    for (const key of [
      'registryVersion',
      'promptId',
      'promptVersion',
      'agentScope',
      'taskClass',
      'resultMode',
      'systemTemplate',
      'contentDigest',
    ]) {
      const partial = Object.fromEntries(
        Object.entries(materialized()).filter(([name]) => name !== key),
      );
      expect(() => createPromptRegistry([asDefinition(partial)])).toThrow(PromptRegistryError);
    }
    expect(() => createPromptRegistry([asDefinition(materialized({ status: 'ACTIVE' }))])).toThrow(
      PromptRegistryError,
    );
  });

  it('rejects malformed scalars inside a materialized definition', () => {
    for (const over of [
      { promptId: 'bad/id' },
      { promptId: 'latest' },
      { promptVersion: 0 },
      { agentScope: 'HUMAN' },
      { taskClass: 'has space' },
      { resultMode: 'JSON' },
      { systemTemplate: '' },
    ]) {
      expect(() => createPromptRegistry([asDefinition(materialized(over))])).toThrow(
        PromptRegistryError,
      );
    }
  });

  it('rejects a primitive, null, array or non-array registry argument', () => {
    for (const bad of [null, 'definition', 42, {}]) {
      expect(() => createPromptRegistry([asDefinition(bad)])).toThrow(PromptRegistryError);
    }
    expect(() =>
      createPromptRegistry('not-an-array' as unknown as readonly PromptDefinition[]),
    ).toThrow(PromptRegistryError);
  });
});

// ---------------------------------------------------------------------------
// F. Duplicates.
// ---------------------------------------------------------------------------

describe('(F) one family/version is ONE byte body, bound to one or more exact task classes', () => {
  const duplicates: readonly {
    readonly name: string;
    readonly second: Partial<PromptDefinitionInput>;
  }[] = [
    { name: 'the identical definition twice', second: {} },
    { name: 'different content', second: { systemTemplate: 'Synthetic different body.' } },
    { name: 'different scope', second: { agentScope: 'VENDOR' } },
    { name: 'different result mode', second: { resultMode: 'TEXT' } },
    {
      name: 'different content under a different task class',
      second: { taskClass: 'OTHER_TASK', systemTemplate: 'Synthetic different body.' },
    },
    {
      name: 'different scope under a different task class',
      second: { taskClass: 'OTHER_TASK', agentScope: 'VENDOR' },
    },
    {
      name: 'different result mode under a different task class',
      second: { taskClass: 'OTHER_TASK', resultMode: 'TEXT' },
    },
  ];

  for (const scenario of duplicates) {
    it(`rejects a duplicate id+version with ${scenario.name}`, () => {
      try {
        createPromptRegistry([definition(), definition(scenario.second)]);
        throw new Error('expected a duplicate rejection');
      } catch (error) {
        expect(error).toBeInstanceOf(PromptRegistryError);
        expect((error as PromptRegistryError).code).toBe('duplicate-definition');
      }
    });
  }

  it('ACCEPTS TASK-CLASS VARIANTS THAT ARE THE SAME REVIEWED BYTES', () => {
    // The narrowing (MVP-P2A.2-P). A reviewed version may be bound to several exact task classes
    // when every variant is the same prompt — which is the real shape of an agent whose serving path
    // resolves more than one task class with no fallback between them.
    const registry = createPromptRegistry([
      definition(),
      definition({ taskClass: 'OTHER_TASK' }),
      definition({ taskClass: 'THIRD_TASK' }),
    ]);
    expect(registry.definitions).toHaveLength(3);
    const digests = new Set(registry.definitions.map((one) => one.contentDigest));
    const bodies = new Set(registry.definitions.map((one) => one.systemTemplate));
    expect(digests.size).toBe(1);
    expect(bodies.size).toBe(1);
  });

  it('a third variant repeating an existing task class is still rejected', () => {
    try {
      createPromptRegistry([
        definition(),
        definition({ taskClass: 'OTHER_TASK' }),
        definition({ taskClass: 'OTHER_TASK' }),
      ]);
      throw new Error('expected a duplicate rejection');
    } catch (error) {
      expect((error as PromptRegistryError).code).toBe('duplicate-definition');
    }
  });

  it('compares every variant against the FIRST body, not against its neighbour', () => {
    // Otherwise a chain of pairwise-compatible definitions could drift across the set.
    try {
      createPromptRegistry([
        definition(),
        definition({ taskClass: 'OTHER_TASK' }),
        definition({ taskClass: 'THIRD_TASK', systemTemplate: 'Synthetic different body.' }),
      ]);
      throw new Error('expected a duplicate rejection');
    } catch (error) {
      expect((error as PromptRegistryError).code).toBe('duplicate-definition');
    }
  });

  it('RESOLVES THE EXACT VARIANT, AND RETURNS NO SIBLING', () => {
    const registry = createPromptRegistry([
      definition(),
      definition({ taskClass: 'OTHER_TASK' }),
      definition({ taskClass: 'THIRD_TASK' }),
    ]);
    const base = definition();
    for (const taskClass of [base.taskClass, 'OTHER_TASK', 'THIRD_TASK']) {
      const resolved = registry.resolve({
        promptId: base.promptId,
        promptVersion: base.promptVersion,
        agentScope: base.agentScope,
        taskClass,
        resultMode: base.resultMode,
      });
      expect(resolved?.taskClass, taskClass).toBe(taskClass);
    }
    // A task class that is not registered is a miss, never the first sibling.
    expect(
      registry.resolve({
        promptId: base.promptId,
        promptVersion: base.promptVersion,
        agentScope: base.agentScope,
        taskClass: 'UNREGISTERED_TASK',
        resultMode: base.resultMode,
      }),
    ).toBeUndefined();
  });

  it('orders variants deterministically regardless of caller order', () => {
    const forward = createPromptRegistry([
      definition(),
      definition({ taskClass: 'OTHER_TASK' }),
      definition({ taskClass: 'THIRD_TASK' }),
    ]);
    const backward = createPromptRegistry([
      definition({ taskClass: 'THIRD_TASK' }),
      definition({ taskClass: 'OTHER_TASK' }),
      definition(),
    ]);
    expect(backward.definitions.map((one) => one.taskClass)).toStrictEqual(
      forward.definitions.map((one) => one.taskClass),
    );
  });

  it('allows the same id at a different version, and the same version under a different id', () => {
    expect(createPromptRegistry([definition(), definition({ promptVersion: 2 })])).toBeDefined();
    expect(
      createPromptRegistry([definition(), definition({ promptId: 'reply.other' })]),
    ).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// G. Resolution.
// ---------------------------------------------------------------------------

describe('(G) resolution is exact, with no fallback of any kind', () => {
  const registry = createPromptRegistry([
    definition({ promptVersion: 1 }),
    definition({ promptVersion: 2 }),
    definition({ promptVersion: 3 }),
    definition({ promptId: 'reply.vendor', agentScope: 'VENDOR' }),
  ]);

  it('resolves an exact identity, scope, task and result mode', () => {
    const found = registry.resolve(request({ promptVersion: 2 }));
    expect(found?.promptId).toBe('reply.client');
    expect(found?.promptVersion).toBe(2);
    // The canonical registry object, not a copy.
    expect(found).toBe(registry.definitions.find((d) => d.promptVersion === 2));
    expect(Object.isFrozen(found)).toBe(true);
  });

  const misses: readonly {
    readonly name: string;
    readonly over: Partial<PromptResolutionRequest>;
  }[] = [
    { name: 'an unknown promptId', over: { promptId: 'reply.absent' } },
    { name: 'an unknown version', over: { promptVersion: 99 } },
    { name: 'a wrong agent scope', over: { agentScope: 'VENDOR' } },
    { name: 'a wrong task class', over: { taskClass: 'OTHER_TASK' } },
    { name: 'a wrong result mode', over: { resultMode: 'TEXT' } },
  ];

  for (const scenario of misses) {
    it(`returns undefined for ${scenario.name}, never a substitute`, () => {
      expect(registry.resolve(request(scenario.over))).toBeUndefined();
    });
  }

  it('never falls back to a higher, lower or newest version', () => {
    // Versions 1-3 exist; asking for 4 must not yield 3, and asking for a gap must not yield a neighbour.
    expect(registry.resolve(request({ promptVersion: 4 }))).toBeUndefined();
    expect(registry.resolve(request({ promptVersion: 0 + 99 }))).toBeUndefined();
    // A cross-agent request for an id that exists under another scope resolves to nothing.
    expect(
      registry.resolve(request({ promptId: 'reply.vendor', agentScope: 'CLIENT' })),
    ).toBeUndefined();
  });

  it('throws invalid-resolution for a structurally malformed request', () => {
    const malformed: readonly unknown[] = [
      null,
      [],
      'request',
      42,
      { ...request(), extra: 'x' },
      request({ promptId: '*' }),
      request({ promptId: 'latest' }),
      request({ promptId: 'has/slash' }),
      request({ promptVersion: 0 }),
      request({ promptVersion: 1.5 }),
      request({ agentScope: 'HUMAN' as PromptAgentScope }),
      request({ taskClass: 'has space' }),
      request({ resultMode: 'JSON' as PromptResultMode }),
    ];
    for (const bad of malformed) {
      try {
        registry.resolve(bad as PromptResolutionRequest);
        throw new Error('expected a resolution rejection');
      } catch (error) {
        expect(error).toBeInstanceOf(PromptRegistryError);
        expect((error as PromptRegistryError).code).toBe('invalid-resolution');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// H, I. Error normalization and frozen vocabularies.
// ---------------------------------------------------------------------------

describe('(H, I) errors are content-free and vocabularies are frozen', () => {
  it('exposes exactly three codes with stable repository-owned messages', () => {
    expect([...PROMPT_REGISTRY_ERROR_CODES]).toEqual([
      'invalid-definition',
      'duplicate-definition',
      'invalid-resolution',
    ]);
    expect(new PromptRegistryError('invalid-definition').message).toBe(
      'A prompt definition is invalid.',
    );
    expect(new PromptRegistryError('duplicate-definition').message).toBe(
      'A duplicate prompt definition is not allowed.',
    );
    expect(new PromptRegistryError('invalid-resolution').message).toBe(
      'A prompt resolution request is invalid.',
    );
    const error = new PromptRegistryError('invalid-definition');
    expect(error.name).toBe('PromptRegistryError');
    expect(Object.isFrozen(error)).toBe(true);
  });

  it('never leaks prompt content, an identifier, a digest or a zod detail', () => {
    const secretish = 'Synthetic body that must never appear in an error.';
    try {
      createPromptDefinition(input({ systemTemplate: secretish, promptId: 'bad/id' }));
      throw new Error('expected a throw');
    } catch (error) {
      const message = (error as PromptRegistryError).message;
      expect(message).toBe('A prompt definition is invalid.');
      for (const forbidden of [secretish, 'bad/id', 'zod', 'regex', 'promptId', 'invalid_string']) {
        expect(message).not.toContain(forbidden);
      }
    }
  });

  it('freezes every exported vocabulary array', () => {
    for (const array of [
      PROMPT_AGENT_SCOPES_FROZEN,
      PROMPT_RESULT_MODES_FROZEN,
      PROMPT_REGISTRY_ERROR_CODES,
    ]) {
      expect(Object.isFrozen(array)).toBe(true);
      expect(() => (array as unknown as unknown[]).push('x')).toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// J, K. Source containment and the public API.
// ---------------------------------------------------------------------------

describe('(J, K) source containment and the exact public API', () => {
  it('contains no network, environment, provider, storage or lifecycle surface', () => {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith('.ts') && !full.includes('tests')) {
          files.push(full);
        }
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(0);

    let cryptoImports = 0;
    for (const file of files) {
      // Comments legitimately EXPLAIN the forbidden surfaces, so they are stripped before scanning.
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split(String.fromCharCode(10))
        .filter((line) => !/^\s*\/\//.test(line))
        .join(String.fromCharCode(10));
      if (code.includes('node:crypto')) {
        cryptoImports += 1;
        expect(file).toContain('prompt-digest');
      }
      for (const forbidden of [
        'fetch(',
        'node:http',
        'node:fs',
        'child_process',
        'process.env',
        'supabase',
        'postgres',
        'n8n',
        'whatsapp',
        'groq',
        'ACTIVE',
        'RETIRED',
        'approvalStatus',
        'render(',
        'handlebars',
        'mustache',
        'REPLY_PROMPT_CONTRACT',
      ]) {
        expect(code.toLowerCase()).not.toContain(forbidden.toLowerCase());
      }
    }
    // node:crypto appears exactly once, in the internal digest module.
    expect(cryptoImports).toBe(1);
  });

  it('the root surface is exactly seven runtime symbols', async () => {
    const barrel = (await import('../index.js')) as unknown as Record<string, unknown>;
    expect(Object.keys(barrel).sort()).toEqual([
      'PROMPT_AGENT_SCOPES_FROZEN',
      'PROMPT_REGISTRY_ERROR_CODES',
      'PROMPT_REGISTRY_VERSION',
      'PROMPT_RESULT_MODES_FROZEN',
      'PromptRegistryError',
      'createPromptDefinition',
      'createPromptRegistry',
    ]);
    expect(Object.keys(barrel)).toHaveLength(7);
    expect((barrel as { default?: unknown }).default).toBeUndefined();

    // The digest helper and every internal schema stay unexported.
    for (const internal of [
      'promptContentDigest',
      'promptDefinitionSchema',
      'promptResolutionSchema',
      'isPlainRecord',
      'MATERIALIZED_DEFINITION_KEYS',
      'registryKey',
      'canonicalize',
    ]) {
      expect(barrel[internal]).toBeUndefined();
    }
  });

  it('declares exactly one dependency', () => {
    const manifestPath = fileURLToPath(new URL('../../package.json', import.meta.url));
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      name: string;
      dependencies: Record<string, string>;
    };
    expect(manifest.name).toBe('@qf-jarvis/prompt-registry');
    expect(Object.keys(manifest.dependencies)).toEqual(['zod']);
  });
});

// ---------------------------------------------------------------------------
// (L) Unicode well-formedness — the final-review regression.
//
// Node's UTF-8 encoder replaces EVERY unpaired UTF-16 surrogate with U+FFFD before hashing, so
// several distinct JavaScript strings encode to the same three bytes and therefore share a digest.
// That is not a SHA-256 collision; it is a lossy encoder meeting an input the contract never
// excluded. Templates must now be well-formed Unicode, and ill-formed ones are REFUSED, never
// repaired — repairing would hash text the reviewer never wrote.
// ---------------------------------------------------------------------------

describe('(L) a system template must be well-formed Unicode', () => {
  const HIGH_D800 = String.fromCharCode(0xd800);
  const HIGH_D801 = String.fromCharCode(0xd801);
  const LOW_DC00 = String.fromCharCode(0xdc00);

  it('demonstrates the encoding hazard this rule exists to close', () => {
    // All three are distinct strings...
    expect(HIGH_D800).not.toBe(HIGH_D801);
    expect(HIGH_D800).not.toBe(LOW_DC00);
    // ...yet Node encodes every one of them to the same replacement bytes.
    const bytes = [HIGH_D800, HIGH_D801, LOW_DC00].map((s) =>
      Buffer.from(s, 'utf8').toString('hex'),
    );
    expect(bytes).toEqual(['efbfbd', 'efbfbd', 'efbfbd']);
    const digests = [HIGH_D800, HIGH_D801, LOW_DC00].map((s) =>
      createHash('sha256').update(s, 'utf8').digest('hex'),
    );
    expect(new Set(digests).size).toBe(1);
  });

  const illFormed: readonly { readonly name: string; readonly template: string }[] = [
    { name: 'a lone high surrogate D800', template: HIGH_D800 },
    { name: 'a different lone high surrogate D801', template: HIGH_D801 },
    { name: 'a lone low surrogate DC00', template: LOW_DC00 },
    { name: 'a lone high surrogate embedded in text', template: `prefix${HIGH_D800}suffix` },
    { name: 'a lone low surrogate embedded in text', template: `prefix${LOW_DC00}suffix` },
    { name: 'a reversed pair (low then high)', template: `${LOW_DC00}${HIGH_D800}` },
    { name: 'a trailing high surrogate', template: `Synthetic prompt.${HIGH_D800}` },
  ];

  for (const scenario of illFormed) {
    it(`rejects ${scenario.name}`, () => {
      expect(() => definition({ systemTemplate: scenario.template })).toThrow(PromptRegistryError);
    });
  }

  it('rejects the previously-colliding strings BEFORE any definition can exist', () => {
    // Neither can be constructed, so the shared digest is now unreachable rather than merely unlikely.
    for (const template of [HIGH_D800, HIGH_D801, LOW_DC00]) {
      try {
        definition({ systemTemplate: template });
        throw new Error('expected a rejection');
      } catch (error) {
        expect(error).toBeInstanceOf(PromptRegistryError);
        expect((error as PromptRegistryError).code).toBe('invalid-definition');
        expect((error as PromptRegistryError).message).toBe('A prompt definition is invalid.');
        // The offending value never appears in the message.
        expect((error as PromptRegistryError).message).not.toContain(template);
        expect((error as PromptRegistryError).message.toLowerCase()).not.toContain('surrogate');
      }
    }
  });

  it('still accepts valid surrogate pairs and supplementary characters', () => {
    const emoji = '🙂';
    const fromCodePoint = String.fromCodePoint(0x1f642);
    expect(emoji).toBe(fromCodePoint);

    for (const template of [
      emoji,
      fromCodePoint,
      `Synthetic prompt ${emoji} tail.`,
      '日本語 — é',
    ]) {
      const built = definition({ systemTemplate: template });
      expect(built.systemTemplate).toBe(template);
      // Independently computed: the digest is still plain SHA-256 over exact UTF-8 bytes.
      expect(built.contentDigest).toBe(createHash('sha256').update(template, 'utf8').digest('hex'));
    }

    // A valid pair encodes to real four-byte UTF-8, not to the replacement character.
    expect(Buffer.from(emoji, 'utf8').toString('hex')).toBe('f09f9982');
  });

  it('does not repair: a rejected template is never silently normalized into an accepted one', () => {
    const illFormedTemplate = `prefix${HIGH_D800}suffix`;
    expect(() => definition({ systemTemplate: illFormedTemplate })).toThrow(PromptRegistryError);
    // The caller's string is untouched, and the "repaired" form is a DIFFERENT template that the
    // caller would have to write deliberately.
    expect(illFormedTemplate).toContain(HIGH_D800);
    const repaired = 'prefixsuffix';
    expect(definition({ systemTemplate: repaired }).systemTemplate).toBe(repaired);
    expect(definition({ systemTemplate: repaired }).contentDigest).not.toBe(
      createHash('sha256').update(illFormedTemplate, 'utf8').digest('hex'),
    );
  });

  it('rejects a forged materialized definition whose digest matches the lossy encoding', () => {
    // The forgery: an ill-formed template plus the digest Node WOULD produce for it. Before this
    // rule the digest check would have passed, because the encoder makes both sides agree.
    const illFormedTemplate = HIGH_D800;
    const lossyDigest = createHash('sha256').update(illFormedTemplate, 'utf8').digest('hex');
    expect(lossyDigest).toBe(createHash('sha256').update(HIGH_D801, 'utf8').digest('hex'));

    const forged = {
      registryVersion: 1,
      promptId: 'reply.client',
      promptVersion: 1,
      agentScope: 'CLIENT',
      taskClass: 'RESPONSE_GENERATION',
      resultMode: 'STRUCTURED',
      systemTemplate: illFormedTemplate,
      contentDigest: lossyDigest,
    };

    try {
      createPromptRegistry([asDefinition(forged)]);
      throw new Error('expected a rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(PromptRegistryError);
      expect((error as PromptRegistryError).code).toBe('invalid-definition');
      expect((error as PromptRegistryError).message).toBe('A prompt definition is invalid.');
    }
  });
});
