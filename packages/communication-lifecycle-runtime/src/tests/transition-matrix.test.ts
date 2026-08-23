/**
 * The exhaustive 18x18 matrix, and the graph's tie to the authoritative document
 * (QFJ-P09.05, ADR-0110).
 *
 * ### Why the expected edges are re-derived from the markdown
 *
 * A matrix that checks the runtime against the constant the runtime uses proves only that a lookup
 * table can be read twice. The claim worth proving is that the table IS the approved communication
 * model -- so the expectation is parsed out of the `stateDiagram-v2` block in
 * docs/architecture/communication-model.md on every run, and the constant is compared against it.
 *
 * That makes the document load-bearing in both directions. Editing the diagram without editing the
 * table fails here; editing the table without editing the diagram fails here too. Neither can drift
 * quietly, which is the whole reason the graph was described as "reused, not reinvented".
 *
 * The diagram renders its nodes in snake_case. The canonical machine values are the kebab-case
 * members of `COMMUNICATION_STATES`, so the parser normalises and then asserts that every normalised
 * node is a real canonical state -- a typo in the document surfaces as an unknown state rather than
 * as a silently dropped edge.
 *
 * ### And the state list comes from the contracts, not from here
 *
 * Nothing in this file restates the eighteen values. They are read from `COMMUNICATION_STATES`, so a
 * nineteenth state added to the contracts immediately makes this a 19x19 sweep with no edges
 * declared for it, and the new pairs fail until somebody decides its policy.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import {
  COMMUNICATION_STATE_COUNT,
  COMMUNICATION_STATES,
  type CommunicationState,
} from '@qf-jarvis/contracts';

import { evaluateCommunicationLifecycleTransition } from '../evaluate-communication-lifecycle-transition.js';
import {
  COMMUNICATION_LIFECYCLE_START_STATE,
  COMMUNICATION_LIFECYCLE_TRANSITIONS,
} from '../policy/transition-graph.js';
import { EARLIER, LATER, stateRecord } from './fixtures.js';

const REPO_ROOT = new URL('../../../../', import.meta.url);
const MODEL_DOC = fileURLToPath(new URL('docs/architecture/communication-model.md', REPO_ROOT));

const CANONICAL_STATES: readonly string[] = COMMUNICATION_STATES;

/** `follow_up_requested` in the diagram is `follow-up-requested` in the contracts. */
function toCanonicalState(node: string): CommunicationState {
  const normalised = node.replace(/_/g, '-');
  if (!CANONICAL_STATES.includes(normalised)) {
    throw new Error(`communication-model.md names a state the contracts do not have: ${node}`);
  }
  return normalised as CommunicationState;
}

interface DocumentGraph {
  readonly edges: ReadonlyMap<CommunicationState, readonly CommunicationState[]>;
  readonly startStates: readonly CommunicationState[];
  readonly sinkStates: readonly CommunicationState[];
  readonly edgeCount: number;
}

/** Parse the authoritative `stateDiagram-v2` block. Nothing about it is guessed. */
function readDocumentGraph(): DocumentGraph {
  const text = readFileSync(MODEL_DOC, 'utf8');
  const block = /```mermaid\s*\nstateDiagram-v2\n([\s\S]*?)```/.exec(text);
  expect(block, 'communication-model.md must contain exactly one stateDiagram-v2 block').not.toBe(
    null,
  );

  const body = block?.[1] ?? '';
  const edges = new Map<CommunicationState, CommunicationState[]>();
  const startStates: CommunicationState[] = [];
  const sinkStates: CommunicationState[] = [];
  let edgeCount = 0;

  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    const match = /^(\[\*\]|[a-z_]+)\s*-->\s*(\[\*\]|[a-z_]+)\s*(?::.*)?$/.exec(line);
    expect(match, `unparsed line in the authoritative diagram: ${line}`).not.toBe(null);
    if (match === null) {
      continue;
    }
    const [, from = '', to = ''] = match;

    if (from === '[*]') {
      startStates.push(toCanonicalState(to));
      continue;
    }
    if (to === '[*]') {
      sinkStates.push(toCanonicalState(from));
      continue;
    }

    const source = toCanonicalState(from);
    const target = toCanonicalState(to);
    const existing = edges.get(source) ?? [];
    expect(existing, `the diagram declares ${from} --> ${to} twice`).not.toContain(target);
    edges.set(source, [...existing, target]);
    edgeCount += 1;
  }

  return { edges, startStates, sinkStates, edgeCount };
}

const DOC = readDocumentGraph();

function documentEdgesFrom(state: CommunicationState): readonly CommunicationState[] {
  return DOC.edges.get(state) ?? [];
}

describe('the canonical vocabulary', () => {
  it('is exactly eighteen states, with no nineteenth', () => {
    expect(COMMUNICATION_STATES).toHaveLength(COMMUNICATION_STATE_COUNT);
    expect(COMMUNICATION_STATE_COUNT).toBe(18);
    expect(new Set(COMMUNICATION_STATES).size).toBe(18);
  });

  it('is the exact key set of the transition table, so the policy is total', () => {
    expect(Object.keys(COMMUNICATION_LIFECYCLE_TRANSITIONS).sort()).toEqual(
      [...COMMUNICATION_STATES].sort(),
    );
  });

  it('never names a destination the contracts do not have', () => {
    for (const state of COMMUNICATION_STATES) {
      for (const destination of COMMUNICATION_LIFECYCLE_TRANSITIONS[state]) {
        expect(CANONICAL_STATES, `${state} -> ${destination}`).toContain(destination);
      }
    }
  });
});

describe('the transition table is the approved communication model', () => {
  it('matches docs/architecture/communication-model.md edge for edge', () => {
    for (const state of COMMUNICATION_STATES) {
      expect([...COMMUNICATION_LIFECYCLE_TRANSITIONS[state]].sort(), state).toEqual(
        [...documentEdgesFrom(state)].sort(),
      );
    }
  });

  it('holds thirty-seven edges, counted from the document rather than asserted', () => {
    const tableEdges = COMMUNICATION_STATES.reduce(
      (total, state) => total + COMMUNICATION_LIFECYCLE_TRANSITIONS[state].length,
      0,
    );
    expect(tableEdges).toBe(DOC.edgeCount);
    // Pinned so that a diagram edit which changes the total is visible in the diff, not just in a
    // comparison that quietly re-derives both sides.
    expect(DOC.edgeCount).toBe(37);
  });

  it('starts only at draft, and ends only at completed', () => {
    expect(DOC.startStates).toEqual(['draft']);
    expect(COMMUNICATION_LIFECYCLE_START_STATE).toBe('draft');
    expect(DOC.sinkStates).toEqual(['completed']);
  });

  it('gives completed no outgoing edge', () => {
    expect(COMMUNICATION_LIFECYCLE_TRANSITIONS.completed).toEqual([]);
    expect(documentEdgesFrom('completed')).toEqual([]);
  });

  it('declares no self-transition anywhere', () => {
    for (const state of COMMUNICATION_STATES) {
      expect(COMMUNICATION_LIFECYCLE_TRANSITIONS[state], state).not.toContain(state);
    }
  });
});

describe('the exhaustive 18x18 pairwise matrix', () => {
  const pairs = COMMUNICATION_STATES.flatMap((from) =>
    COMMUNICATION_STATES.map((to) => ({ from, to })),
  );

  it('covers all 324 ordered pairs', () => {
    expect(pairs).toHaveLength(COMMUNICATION_STATE_COUNT * COMMUNICATION_STATE_COUNT);
    expect(pairs).toHaveLength(324);
  });

  it.each(pairs)(
    '$from -> $to is allowed iff the authoritative graph contains it',
    ({ from, to }) => {
      const result = evaluateCommunicationLifecycleTransition({
        current: stateRecord({ state: from, recordedAt: EARLIER }),
        next: stateRecord({ state: to, previousState: from, recordedAt: LATER }),
      });

      const expected = documentEdgesFrom(from).includes(to);
      expect(result.ok, `${from} -> ${to}`).toBe(expected);
      if (!result.ok) {
        // Every refusal in this sweep is about the EDGE. Identity, history and ordering are all
        // correct by construction here, so any other reason would mean a different rule fired and the
        // matrix was proving something other than what it claims.
        expect(result.reason, `${from} -> ${to}`).toBe('transition-not-allowed');
      }
    },
  );

  it('refuses all eighteen self-transitions', () => {
    for (const state of COMMUNICATION_STATES) {
      const result = evaluateCommunicationLifecycleTransition({
        current: stateRecord({ state, recordedAt: EARLIER }),
        next: stateRecord({ state, previousState: state, recordedAt: LATER }),
      });
      expect(result.ok, state).toBe(false);
    }
  });
});

describe('lifecycle start', () => {
  it.each(COMMUNICATION_STATES)('accepts a first record only when it is draft: %s', (state) => {
    const result = evaluateCommunicationLifecycleTransition({
      current: null,
      next: stateRecord({ state, recordedAt: EARLIER }),
    });

    if (state === 'draft') {
      expect(result.ok).toBe(true);
      return;
    }
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.reason).toBe('initial-state-not-draft');
  });

  it('refuses an initial draft that claims a previous state', () => {
    const result = evaluateCommunicationLifecycleTransition({
      current: null,
      next: stateRecord({ state: 'draft', previousState: 'authorization-requested' }),
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.reason).toBe('initial-previous-state-present');
  });
});
