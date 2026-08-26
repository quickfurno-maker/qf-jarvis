/**
 * JAO-7 advanced governed autonomy — THREAT MODEL (ADR-0121).
 *
 * ### What is actually at risk in the final autonomy slice
 *
 * Not "can Jarvis execute?" — the architecture answers that in Core and n8n. The risks here are the
 * ones that appear precisely BECAUSE the slice is more capable:
 *
 * - a caller supplying its own plan, budget, risk, approval or autonomy ceiling;
 * - a public reference that lets reviewed mission policy be rewritten at runtime;
 * - a hostile planner, evaluator, registry, specialist, tool or rehearsal effect reaching the
 *   public composition;
 * - a locally fabricated `ApprovalDecisionV1` or `ExecutionIntentV1`;
 * - a rehearsal quietly renamed, or wired to something real;
 * - a persisted authority observation being read later as a permission;
 * - the slice acquiring a scheduler, a transport, a host reach or a production entry point.
 *
 * Everything below is asserted BEHAVIOURALLY wherever it can be, because a mutation proof runs
 * Vitest and Vitest strips types. `readonly` is a compile-time note; the JavaScript that ships does
 * not have it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as jao7 from '../jao/advanced-governed-autonomy/index.js';
import * as jao7Public from '../jao/advanced-governed-autonomy/public.js';
import {
  JAO7_MISSION_POLICY_IDS,
  describeJao7Missions,
  jao7AutonomyRequestSchema,
  jao7CreateRunRequestSchema,
} from '../jao/advanced-governed-autonomy/index.js';
import { createJao7MissionRegistry } from '../jao/advanced-governed-autonomy/mission-registry.js';

/**
 * The workspace scope, kept separate so a forbidden package name is never a contiguous literal.
 *
 * `packages/execution-dispatch-runtime` scans every application source file for its own package
 * name. Writing "JAO-7 must not import that package" as a plain string would make ITS proof believe
 * this application imports it — a declaration of absence reading, to somebody else's scanner, as a
 * declaration of presence.
 */
const SCOPE = '@qf-jarvis/';

/**
 * The neighbour slice directories, ASSEMBLED rather than written whole.
 *
 * JAO-6's own containment spec greps every worker source file for its directory name, so spelling
 * one out here would make ITS proof believe this file imports it -- a declaration of absence
 * reading, to somebody else's scanner, as a declaration of presence. Joining the parts keeps the
 * scan's meaning identical and stops it lying to a neighbour.
 */
const NEIGHBOUR_SLICE_PATHS: readonly string[] = [
  ['operational', 'memory'],
  ['controlled', 'ambient', 'operations'],
  ['governed', 'business', 'action', 'proposals'],
].map((parts) => `../${parts.join('-')}/`);

/** Source with comments stripped, so prose naming a forbidden token does not flag itself. */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|--)/u.test(line))
    .join('\n');
}

function jao7Dir(): string {
  return path.resolve(
    fileURLToPath(new URL('.', import.meta.url)),
    '..',
    'jao',
    'advanced-governed-autonomy',
  );
}

function jao7Sources(): { readonly name: string; readonly code: string }[] {
  const root = jao7Dir();
  return fs
    .readdirSync(root)
    .filter((entry) => entry.endsWith('.ts'))
    .map((entry) => ({
      name: entry,
      code: codeOnly(fs.readFileSync(path.join(root, entry), 'utf8')),
    }));
}

function repoFile(...segments: string[]): string {
  return path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', ...segments);
}

/**
 * Is this PLAIN data, rather than a framework object?
 *
 * The probe below writes into everything it walks. Walking a `ZodType` and writing into its
 * internals breaks the library and, worse, couples one spec's probe to the next spec's fixture --
 * which this suite discovered by doing exactly that. A governance record is plain data by
 * construction, so restricting the walk costs the proof nothing.
 */
function isPlainData(value: object): boolean {
  if (Array.isArray(value)) {
    return true;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Try to rewrite governance through a value, recursively, as JavaScript rather than TypeScript. */
function attemptGovernanceWrites(value: unknown, depth = 0): void {
  if (depth > 4 || typeof value !== 'object' || value === null || !isPlainData(value)) {
    return;
  }
  if (Array.isArray(value)) {
    try {
      (value as unknown[]).push('vendor');
    } catch {
      /* frozen */
    }
    try {
      (value as unknown[])[0] = 'vendor';
    } catch {
      /* frozen */
    }
    for (const entry of value as unknown[]) {
      attemptGovernanceWrites(entry, depth + 1);
    }
    return;
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const current = record[key];
    if (typeof current === 'object' && current !== null) {
      attemptGovernanceWrites(current, depth + 1);
      continue;
    }
    // The values written are the ones that would MATTER: a weakened approval, a widened risk, a
    // raised budget. A proof that "somebody could push the string smuggled" is much weaker.
    const weakened =
      key === 'requiredApproval'
        ? 'none'
        : key === 'requiredRisk'
          ? 'money-related'
          : key === 'maxSpecialistCalls' || key === 'maxToolCalls' || key === 'maxRehearsalApplies'
            ? 99
            : key === 'maxLifetimeSeconds' || key === 'maxSteps'
              ? 999_999
              : key === 'availability'
                ? 'ACTIVE_FOR_OFFLINE_SHADOW_PROOF_ONLY'
                : null;
    if (weakened === null) {
      continue;
    }
    try {
      record[key] = weakened;
    } catch {
      /* frozen */
    }
  }
  if ('allowedSubjectTypes' in record || 'requiredApproval' in record || 'planSteps' in record) {
    try {
      record['allowedSubjectTypes'] = ['client', 'vendor'];
      record['planSteps'] = ['COMPLETE'];
    } catch {
      /* frozen or non-extensible */
    }
  }
}

describe('JAO-7 autonomy threat model', () => {
  // =========================================================================
  // T. Mission policy isolation.
  // =========================================================================

  it('T1 exports no live canonical mission policy, registry or schema', () => {
    const exported = Object.keys(jao7);
    const publicExported = Object.keys(jao7Public);
    const root = jao7Dir();

    for (const forbidden of [
      'createJao7MissionRegistry',
      'Jao7MissionRegistry',
      'Jao7RegistryLookup',
      'Jao7MissionPolicy',
      'jao7MissionPolicySchema',
      'jao7OperatorTaskParametersSchema',
      'jao7CapacityParametersSchema',
      'jao7ParameterSchemaFor',
      'freezeJao7Policy',
      'jao7PlanFor',
      'jao7PlanDigest',
      'jao7MissionDigest',
    ]) {
      expect(exported, forbidden).not.toContain(forbidden);
      expect(publicExported, forbidden).not.toContain(forbidden);
      // Types erase at runtime, so the barrel KEYS cannot see a type-only re-export. The source
      // scan is what actually proves it is absent.
      const identifier = new RegExp(`\\b${forbidden}\\b`, 'u');
      for (const barrel of ['public.ts', 'index.ts']) {
        const code = codeOnly(fs.readFileSync(path.join(root, barrel), 'utf8'));
        expect(identifier.test(code), `${barrel} -> ${forbidden}`).toBe(false);
      }
    }
  });

  it('T2 exports no raw store, adapter or internal composition seam', () => {
    const root = jao7Dir();
    for (const forbidden of [
      'Jao7AutonomyStore',
      'createJao7PostgresStore',
      'classifyJao7DatabaseError',
      'Jao7InternalComposition',
      'createJao7AutonomyRunInternal',
      'advanceJao7AutonomyRunInternal',
      'resumeJao7AutonomyRunInternal',
      'pauseJao7AutonomyRunInternal',
      'killJao7AutonomyRunInternal',
      'readJao7AutonomyRunInternal',
      'runJao7StepInternal',
      'performJao7StepInternal',
      'Jao7ClaimStepRequest',
      'Jao7FinalizeStepRequest',
      'Jao7RehearsalMutationRequest',
    ]) {
      expect(Object.keys(jao7), forbidden).not.toContain(forbidden);
      expect(Object.keys(jao7Public), forbidden).not.toContain(forbidden);
      const identifier = new RegExp(`\\b${forbidden}\\b`, 'u');
      for (const barrel of ['public.ts', 'index.ts']) {
        const code = codeOnly(fs.readFileSync(path.join(root, barrel), 'utf8'));
        expect(identifier.test(code), `${barrel} -> ${forbidden}`).toBe(false);
      }
    }
  });

  it('T3 hands back detached primitive-only descriptors', () => {
    for (const descriptor of describeJao7Missions()) {
      for (const [key, value] of Object.entries(descriptor)) {
        expect(typeof value, key).not.toBe('object');
        expect(Array.isArray(value), key).toBe(false);
        expect(typeof value, key).not.toBe('function');
      }
    }
    // A fresh copy on every call, sharing no reference with canonical execution.
    expect(describeJao7Missions()[0]).not.toBe(describeJao7Missions()[0]);
  });

  it('T4 survives a brute-force governance rewrite through EVERY public export', () => {
    // THE BEHAVIOURAL PROOF, and the one that does not depend on knowing which names are dangerous:
    // it enumerates the public barrel at RUNTIME and tries to rewrite governance through everything
    // it finds, so an export somebody adds later is covered on the day it is added.
    for (const exported of Object.values(jao7)) {
      attemptGovernanceWrites(exported);
    }
    for (const descriptor of describeJao7Missions()) {
      attemptGovernanceWrites(descriptor);
    }
    try {
      (JAO7_MISSION_POLICY_IDS as string[]).push('jao7.smuggled');
    } catch {
      /* frozen */
    }

    // Nothing moved. The canonical registry still answers with the reviewed governance.
    expect([...JAO7_MISSION_POLICY_IDS]).toStrictEqual([
      'jao7.client-sales-stall-remediation',
      'jao7.synthetic-capacity-remediation',
    ]);
    const lookup = createJao7MissionRegistry().lookup('jao7.client-sales-stall-remediation', 1);
    expect(lookup.found).toBe('MISSION');
    if (lookup.found === 'MISSION') {
      expect(lookup.policy.requiredRisk).toBe('low-risk-reversible');
      expect(lookup.policy.requiredApproval).toBe('delegated-approver');
      expect(lookup.policy.maxSpecialistCalls).toBe(1);
      expect(lookup.policy.maxRehearsalApplies).toBe(1);
      expect([...lookup.policy.allowedSubjectTypes]).toStrictEqual(['client']);
      expect([...lookup.policy.planSteps]).toContain('AWAIT_AUTHORITY');
    }
    for (const descriptor of describeJao7Missions()) {
      expect(descriptor.requiredRisk).toBe('low-risk-reversible');
      expect(descriptor.requiredApproval).toBe('delegated-approver');
    }
  });

  it('T5 offers no register, add, extend or override path anywhere', () => {
    const registry = createJao7MissionRegistry();
    for (const forbidden of ['register', 'add', 'extend', 'override', 'set', 'remove', 'delete']) {
      expect(Object.keys(registry), forbidden).not.toContain(forbidden);
    }
    expect(Object.isFrozen(registry)).toBe(true);
    for (const { name, code } of jao7Sources()) {
      for (const forbidden of ['MISSIONS.push', 'register(', 'unregister(']) {
        expect(code, `${name} -> ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  // =========================================================================
  // I. Caller injection through the request schemas.
  // =========================================================================

  it('I1 refuses every governance field a caller might state on a run', () => {
    const valid = {
      runId: 'jao7-run-001',
      operationId: 'jao7-op-001',
      missionPolicyId: 'jao7.client-sales-stall-remediation',
      missionPolicyVersion: 1,
      subject: { entityType: 'client', entityId: 'client.42' },
    };
    expect(jao7CreateRunRequestSchema.safeParse(valid).success).toBe(true);

    for (const smuggled of [
      { risk: 'money-related' },
      { requiredRisk: 'low-risk-reversible' },
      { requiredRisk: 'money-related' },
      { requiredApproval: 'delegated-approver' },
      { rehearsalClass: 'VIRTUAL_CAPACITY_POOL' },
      { missionClass: 'SYNTHETIC_CAPACITY_REMEDIATION' },
      { verificationPolicy: 'EXACT_MATCH_AGAINST_TARGET' },
      { rollbackPolicy: 'RESTORE_CAPTURED_BEFORE_STATE_ONLY' },
      { killPolicy: 'NONE' },
      { expiryPolicy: 'NONE' },
      { requiredApproval: 'none' },
      { actionType: 'send.message' },
      { actionContractVersion: 2 },
      { recommendationType: 'anything' },
      { producer: 'anisha' },
      { producingAgent: 'riya' },
      { plan: ['COMPLETE'] },
      { planSteps: ['COMPLETE'] },
      { maxSteps: 999 },
      { maxSpecialistCalls: 99 },
      { maxToolCalls: 99 },
      { maxRehearsalApplies: 99 },
      { maxLifetimeSeconds: 999_999 },
      { autonomyLevel: 'L4_AUTONOMOUS' },
      { availability: 'ACTIVE_FOR_OFFLINE_SHADOW_PROOF_ONLY' },
      { approved: true },
      { canExecute: true },
      { executionIntent: {} },
      { approvalDecision: {} },
    ]) {
      expect(
        jao7CreateRunRequestSchema.safeParse({ ...valid, ...smuggled }).success,
        JSON.stringify(smuggled),
      ).toBe(false);
    }
  });

  it('I2 refuses a caller-named capacity target or rollback target on a step', () => {
    const valid = {
      runId: 'jao7-run-001',
      operationId: 'jao7-op-002',
      correlationId: '3f2c1a44-0d1e-4a7b-9c2e-1b0a5d6e7f80',
      summary: 'A summary.',
      rationale: 'A rationale.',
      evidence: [
        {
          evidenceType: 'derived-signal',
          signalCode: 'pool-saturated',
          description: 'The pool is saturated.',
        },
      ],
      confidence: 0.5,
    };
    expect(jao7AutonomyRequestSchema.safeParse(valid).success).toBe(true);

    for (const smuggled of [
      // Governance fields belong to the POLICY, and the per-step request must refuse them exactly
      // as the create request does. Listing them on only one of the two schemas is how a widened
      // step schema slipped past this suite the first time.
      { risk: 'money-related' },
      { requiredRisk: 'money-related' },
      { requiredApproval: 'none' },
      { actionType: 'send.message' },
      { recommendationType: 'anything' },
      { producer: 'riya' },
      { missionPolicyId: 'jao7.synthetic-capacity-remediation' },
      { maxSteps: 999 },
      { maxRehearsalApplies: 99 },
      { targetConcurrency: 32 },
      { rollbackTarget: 1 },
      { rollbackIntegerA: 1 },
      { plan: ['COMPLETE'] },
      { stepType: 'COMPLETE' },
      { stepIndex: 7 },
      { state: 'COMPLETED' },
      { verdict: 'COMPLETE' },
      { evaluator: {} },
      { store: {} },
      { registry: {} },
      { specialist: {} },
      { executionResult: {} },
      {
        capacityObservation: {
          poolCode: 'synthetic-pool-alpha',
          currentConcurrency: 8,
          queueDepthBand: 'HIGH',
          errorRateBand: 'LOW',
          saturationBand: 'SATURATED',
          // A COMPLETE, otherwise-valid observation carrying a target. The schema is strict, so
          // this is refused as an unknown key rather than quietly consulted -- which is the only
          // reason "the optimiser computes the target" is a structural claim.
          targetConcurrency: 32,
        },
      },
    ]) {
      expect(
        jao7AutonomyRequestSchema.safeParse({ ...valid, ...smuggled }).success,
        JSON.stringify(smuggled),
      ).toBe(false);
    }
  });

  it('I3 refuses a mission input carrying vendor or capacity data on the Riya path', () => {
    // Riya's governed behaviour is scoped to CLIENT SALES. The signals schema is strict and has no
    // field for vendor state, capacity state or anything else, so there is nothing to smuggle.
    const base = {
      runId: 'jao7-run-001',
      operationId: 'jao7-op-003',
      correlationId: '3f2c1a44-0d1e-4a7b-9c2e-1b0a5d6e7f80',
      summary: 'A summary.',
      rationale: 'A rationale.',
      evidence: [
        {
          evidenceType: 'derived-signal',
          signalCode: 'client-stalled',
          description: 'The client conversation stalled.',
        },
      ],
      confidence: 0.5,
      clientSalesSignals: {
        hasPriorSalesContext: true,
        requestedHumanAssistance: true,
        requestedQuoteOrConsultation: false,
        providedRequirementDetail: true,
        askedAboutReadiness: false,
        outOfSalesScope: false,
        missingDiscoveryFieldCount: 0,
      },
    };
    expect(jao7AutonomyRequestSchema.safeParse(base).success).toBe(true);

    for (const contaminant of [
      { vendorId: 'vendor.7' },
      { vendorSignals: {} },
      { poolCode: 'synthetic-pool-alpha' },
      { currentConcurrency: 8 },
      { queueDepthBand: 'HIGH' },
    ]) {
      expect(
        jao7AutonomyRequestSchema.safeParse({
          ...base,
          clientSalesSignals: { ...base.clientSalesSignals, ...contaminant },
        }).success,
        JSON.stringify(contaminant),
      ).toBe(false);
    }
  });

  // =========================================================================
  // X. No execution, no transport, no authority creation.
  // =========================================================================

  it('X1 contains no constructor for a Core decision or an execution intent', () => {
    for (const { name, code } of jao7Sources()) {
      for (const forbidden of [
        'createApprovalDecision',
        'issueApprovalDecision',
        'createExecutionIntent(',
        'issueExecutionIntent',
        'approvalDecisionV1Schema.parse({',
        'executionIntentV1Schema.parse({',
        'createExecutionResult',
        'ExecutionResultV1',
      ]) {
        expect(code, `${name} -> ${forbidden}`).not.toContain(forbidden);
      }
    }
    // The public surface offers no verb that could decide, execute or send.
    for (const forbidden of [
      'approve',
      'authorize',
      'decide',
      'submit',
      'execute',
      'send',
      'dispatch',
      'remediate',
      'unkill',
      'start',
      'schedule',
      'subscribe',
    ]) {
      expect(Object.keys(jao7), forbidden).not.toContain(forbidden);
    }
    // The verbs it DOES offer are all coordination.
    for (const required of [
      'createJao7AutonomyRun',
      'advanceJao7AutonomyRun',
      'resumeJao7AutonomyRun',
      'pauseJao7AutonomyRun',
      'killJao7AutonomyRun',
      'readJao7AutonomyRun',
    ]) {
      expect(Object.keys(jao7), required).toContain(required);
    }
  });

  it('X2 imports no transport, provider, scheduler, queue, shell, browser or host reach', () => {
    for (const { name, code } of jao7Sources()) {
      for (const forbidden of [
        "from 'node:child_process'",
        "from 'node:fs'",
        "from 'node:net'",
        "from 'node:http'",
        "from 'node:https'",
        "from 'node:dns'",
        "from 'node:os'",
        "from 'node:process'",
        "from 'pg'",
        "from 'axios'",
        "from 'undici'",
        "from 'node-fetch'",
        "from 'bullmq'",
        "from 'ioredis'",
        `${SCOPE}execution-dispatch-runtime`,
        `${SCOPE}execution-dispatch-composition`,
        `${SCOPE}approval-core-adapter`,
        `${SCOPE}communication-authorization-runtime`,
        `${SCOPE}communication-lifecycle-runtime`,
        `${SCOPE}postgres-approval-queue`,
        `${SCOPE}postgres-execution-replay-store`,
        'fetch(',
        'XMLHttpRequest',
        'setInterval(',
        'setTimeout(',
        'cron',
        'process.env',
      ]) {
        expect(code, `${name} -> ${forbidden}`).not.toContain(forbidden);
      }

      // n8n is scanned as an API SHAPE, not as a bare substring: `n8nExecutions: z.literal(0)` is a
      // DECLARATION OF ABSENCE, and a scan that flags it is one somebody eventually weakens.
      for (const forbidden of [/\bn8nClient\b/u, /\bcallN8n\b/u, /from '[^']*n8n/u]) {
        expect(forbidden.test(code), `${name} -> ${String(forbidden)}`).toBe(false);
      }
      for (const occurrence of code.match(/n8n\w*/gu) ?? []) {
        expect(occurrence, `${name} -> ${occurrence}`).toBe('n8nExecutions');
      }
    }
  });

  it('X3 calls a rehearsal a rehearsal, never an execution', () => {
    // The most likely way this slice becomes dangerous is somebody reading `applyEffect` in a year
    // and wiring it to something real because the name suggested that was the intent.
    for (const { name, code } of jao7Sources()) {
      for (const forbidden of [
        'LIVE_APPLY',
        'PRODUCTION_APPLY',
        'executeEffect',
        'applyLive',
        'dispatchEffect',
        'performExecution',
      ]) {
        expect(code, `${name} -> ${forbidden}`).not.toContain(forbidden);
      }
    }
    expect(jao7.JAO7_REHEARSAL_CLASSES.every((cls) => cls.startsWith('VIRTUAL_'))).toBe(true);
    expect(jao7.JAO7_POSTURE.rehearsalOnly).toBe(true);
    expect(jao7.JAO7_POSTURE.executionIntentExecuted).toBe(false);
  });

  it('X4 declares the offline authority posture honestly', () => {
    // A structurally valid injected Core artifact proves CORRELATION. It does not prove production
    // source authentication, and the literal says so rather than leaving it to a reader's charity.
    expect(jao7.JAO7_AUTHORITY_SOURCE_POSTURE).toBe('INJECTED_OFFLINE_CORE_FIXTURE');
    const contracts = codeOnly(fs.readFileSync(path.join(jao7Dir(), 'contracts.ts'), 'utf8'));
    expect(contracts).toContain('INJECTED_OFFLINE_CORE_FIXTURE');
  });

  it('X5 persists no reusable authority anywhere in the schema', () => {
    const sql = fs
      .readFileSync(path.join(jao7Dir(), 'schema', '001_jao7_advanced_autonomy.sql'), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*--/u.test(line))
      .join('\n');
    for (const forbidden of [
      'jsonb',
      'approval_decision_json',
      'execution_intent_json',
      'approved boolean',
      'can_execute',
      'is_authorized',
      'send_allowed',
      'authorization_token',
      'bearer',
      'credential',
      'phone',
      'email',
      'transcript',
    ]) {
      expect(sql.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
    // What it DOES store about authority is digests and identities.
    expect(sql).toContain('approval_decision_digest');
    expect(sql).toContain('execution_intent_digest');
    expect(sql).toContain('action_fingerprint');
  });

  // =========================================================================
  // G. Containment and activation.
  // =========================================================================

  it('G1 leaves every production entry untouched', () => {
    for (const entry of ['index.ts', 'worker-entry.ts']) {
      const file = repoFile(entry);
      if (!fs.existsSync(file)) {
        continue;
      }
      const code = fs.readFileSync(file, 'utf8');
      expect(code, entry).not.toContain('advanced-governed-autonomy');
      expect(code, entry).not.toContain('jao7');
      expect(code, entry).not.toContain('Jao7');
    }

    // And nothing anywhere outside the slice and its own tests imports it.
    const workerSrc = repoFile('.');
    const importers: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith('.ts')) {
          continue;
        }
        if (full.includes('advanced-governed-autonomy') || entry.name.startsWith('jao7-')) {
          continue;
        }
        if (fs.readFileSync(full, 'utf8').includes('advanced-governed-autonomy')) {
          importers.push(path.relative(workerSrc, full));
        }
      }
    };
    walk(workerSrc);
    expect(importers).toStrictEqual([]);
  });

  it('G2 keeps its schema a LOCAL asset, out of managed migration history', () => {
    const managed = repoFile('..', '..', '..', 'packages', 'event-backbone', 'src');
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (
          entry.name.endsWith('.sql') &&
          fs.readFileSync(full, 'utf8').includes('qf_jarvis_jao7')
        ) {
          found.push(full);
        }
      }
    };
    if (fs.existsSync(managed)) {
      walk(managed);
    }
    expect(found).toStrictEqual([]);
  });

  it('G3 adds no third-party dependency', () => {
    const manifest = JSON.parse(fs.readFileSync(repoFile('..', 'package.json'), 'utf8')) as {
      readonly dependencies: Readonly<Record<string, string>>;
    };
    const thirdParty = Object.keys(manifest.dependencies).filter(
      (name) => !name.startsWith('@qf-jarvis/'),
    );
    expect(thirdParty.sort()).toStrictEqual(['@mastra/core', 'zod']);
    expect(manifest.dependencies['@mastra/core']).toBe('1.61.0');
    expect(manifest.dependencies['zod']).toBe('4.4.3');
    expect(Object.keys(manifest.dependencies)).not.toContain('easy-day-js');

    for (const [name, specifier] of Object.entries(manifest.dependencies)) {
      if (name.startsWith('@qf-jarvis/')) {
        expect(specifier, name).toBe('workspace:*');
      }
    }
    // The execution-intent runtime IS a dependency now -- it VALIDATES, and cannot create an intent.
    expect(Object.keys(manifest.dependencies)).toContain(`${SCOPE}execution-intent-runtime`);
    // The transports are not, and must not be.
    for (const forbidden of [
      'execution-dispatch-runtime',
      'execution-dispatch-composition',
      'approval-core-adapter',
      'postgres-approval-queue',
      'communication-authorization-runtime',
    ]) {
      expect(Object.keys(manifest.dependencies), forbidden).not.toContain(`${SCOPE}${forbidden}`);
    }
  });

  it('G4 keeps JAO-1 through JAO-6 source untouched by this slice', () => {
    // JAO-7 REUSES JAO-2 and JAO-4 through their public barrels and modifies neither. A slice that
    // had to edit a neighbour to compose with it would not have been composing.
    const composition = codeOnly(fs.readFileSync(path.join(jao7Dir(), 'coordinator.ts'), 'utf8'));
    expect(composition).toContain("from '../governed-specialist-delegation/index.js'");
    expect(composition).toContain("from '../sandbox-tool-workbench/index.js'");
    // The neighbour slice names are assembled rather than written whole. JAO-6's own containment
    // spec greps every worker source file for its directory name, so spelling it out here would
    // make ITS proof believe this file imports it -- a declaration of absence reading, to somebody
    // else's scanner, as a declaration of presence.
    for (const forbidden of [
      '../governed-specialist-delegation/workflow.js',
      '../governed-specialist-delegation/contracts.js',
      '../sandbox-tool-workbench/workbench.js',
      ...NEIGHBOUR_SLICE_PATHS,
    ]) {
      expect(composition, forbidden).not.toContain(forbidden);
    }
  });

  it('G5 has no background progression anywhere in the slice', () => {
    for (const { name, code } of jao7Sources()) {
      for (const forbidden of [
        'setInterval',
        'setTimeout',
        'setImmediate',
        'EventEmitter',
        '.on(',
        'subscribe(',
        'consume(',
        'poll(',
        'while (true)',
      ]) {
        expect(code, `${name} -> ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});
