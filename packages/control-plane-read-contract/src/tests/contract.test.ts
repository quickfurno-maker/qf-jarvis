import { describe, expect, it } from 'vitest';

import {
  CONTROL_PLANE_READ_CONTRACT_ERROR_CODES,
  CONTROL_PLANE_READ_CONTRACT_VERSION,
  ControlPlaneReadContractError,
  parseControlPlaneSnapshotV1,
} from '../index.js';
import { mutableSnapshot, validSnapshot } from './fixtures.js';

/**
 * Contract behaviour (JOS-01B, ADR-0086).
 *
 * The negative cases all start from `validSnapshot()` and break exactly one thing. That is the only
 * way a rejection test proves anything: if the base were invalid for an unrelated reason, every
 * negative case would pass while testing nothing. The first test pins the base down.
 */

/**
 * Read a named section from a mutable fixture.
 *
 * `noUncheckedIndexedAccess` makes every index access optional, and this repository forbids `!`.
 * Throwing on a missing key is the honest alternative: if the fixture stops carrying the section a
 * test is about, that test should fail loudly rather than silently assert against `undefined`.
 */
const sectionAt = (
  sections: Record<string, Record<string, unknown>>,
  name: string,
): Record<string, unknown> => {
  const section = sections[name];
  if (section === undefined) {
    throw new Error(`fixture is missing section ${name}`);
  }
  return section;
};

const codeOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    return error instanceof ControlPlaneReadContractError
      ? error.code
      : `unexpected:${String(error)}`;
  }
  return 'no-error-thrown';
};

describe('the contract version', () => {
  it('is exactly "1"', () => {
    expect(CONTROL_PLANE_READ_CONTRACT_VERSION).toBe('1');
  });

  it('rejects any other declared version before reporting shape errors', () => {
    const payload = mutableSnapshot();
    payload['contractVersion'] = '2';
    expect(codeOf(() => parseControlPlaneSnapshotV1(payload))).toBe('contract-version-unsupported');

    // A v2 payload that is ALSO structurally wrong still reports the version, not a field list:
    // telling a caller they made forty mistakes when they made one is a worse diagnostic.
    const alsoBroken = mutableSnapshot();
    alsoBroken['contractVersion'] = '2';
    delete alsoBroken['agents'];
    expect(codeOf(() => parseControlPlaneSnapshotV1(alsoBroken))).toBe(
      'contract-version-unsupported',
    );
  });
});

describe('parsing', () => {
  it('accepts the reference snapshot', () => {
    const parsed = parseControlPlaneSnapshotV1(validSnapshot());
    expect(parsed.contractVersion).toBe('1');
    expect(parsed.mode).toBe('READ_ONLY');
  });

  it('rejects a non-object payload as malformed', () => {
    for (const payload of [null, undefined, 42, 'snapshot', true, []]) {
      expect(codeOf(() => parseControlPlaneSnapshotV1(payload))).toBe('snapshot-malformed');
    }
  });

  it('rejects unknown fields at every level', () => {
    const root = mutableSnapshot();
    root['injected'] = true;
    expect(codeOf(() => parseControlPlaneSnapshotV1(root))).toBe('snapshot-invalid');

    const nested = mutableSnapshot();
    (nested['source'] as Record<string, unknown>)['trustMe'] = true;
    expect(codeOf(() => parseControlPlaneSnapshotV1(nested))).toBe('snapshot-invalid');

    const deep = mutableSnapshot();
    const sections = deep['sections'] as Record<string, Record<string, unknown>>;
    const queue = sectionAt(sections, 'approvalQueue');
    queue['extra'] = 1;
    expect(codeOf(() => parseControlPlaneSnapshotV1(deep))).toBe('snapshot-invalid');
  });

  it('rejects a generatedAt that is not a canonical UTC instant', () => {
    for (const instant of [
      '2026-08-03T12:00:00Z', // no milliseconds
      '2026-08-03T12:00:00.000+05:30', // local offset
      '2026-08-03 12:00:00.000Z', // no T
      '2026-13-03T12:00:00.000Z', // impossible month
      '2026-02-31T12:00:00.000Z', // impossible day
      'now',
      '',
    ]) {
      const payload = mutableSnapshot();
      payload['generatedAt'] = instant;
      expect(
        codeOf(() => parseControlPlaneSnapshotV1(payload)),
        instant,
      ).toBe('snapshot-invalid');
    }
  });

  it('rejects rollout.enabled true — V1 has no true', () => {
    const payload = mutableSnapshot();
    (payload['rollout'] as Record<string, unknown>)['enabled'] = true;
    expect(codeOf(() => parseControlPlaneSnapshotV1(payload))).toBe('snapshot-invalid');

    const state = mutableSnapshot();
    (state['rollout'] as Record<string, unknown>)['state'] = 'ROLLOUT_ON';
    expect(codeOf(() => parseControlPlaneSnapshotV1(state))).toBe('snapshot-invalid');
  });

  it('rejects any attempt to add an authority field', () => {
    // The exact fields this contract exists to make unrepresentable.
    for (const field of [
      'canExecute',
      'canSend',
      'isAuthorized',
      'consentValid',
      'approvalGranted',
      'dispatchAllowed',
    ]) {
      const root = mutableSnapshot();
      root[field] = true;
      expect(
        codeOf(() => parseControlPlaneSnapshotV1(root)),
        `root.${field}`,
      ).toBe('snapshot-invalid');

      const onAgent = mutableSnapshot();
      const agents = onAgent['agents'] as Record<string, unknown>[];
      const first = agents[0];
      if (first !== undefined) {
        first[field] = true;
      }
      expect(
        codeOf(() => parseControlPlaneSnapshotV1(onAgent)),
        `agent.${field}`,
      ).toBe('snapshot-invalid');
    }
  });

  it('rejects a rewritten authority boundary', () => {
    const payload = mutableSnapshot();
    (payload['authority'] as Record<string, unknown>)['jarvis'] =
      'AUTHORIZES_AND_OWNS_BUSINESS_TRUTH';
    expect(codeOf(() => parseControlPlaneSnapshotV1(payload))).toBe('snapshot-invalid');
  });

  it('rejects an unreadable section that carries rows — unreadable is not empty', () => {
    const payload = mutableSnapshot();
    const sections = payload['sections'] as Record<string, Record<string, unknown>>;
    const queue = sectionAt(sections, 'approvalQueue');
    queue['items'] = [
      {
        id: 'appr-1',
        requestedAction: 'Send a message',
        risk: 'client-or-vendor-facing',
        requestedAuthority: 'authorized-team-human',
        sourceAgent: 'Anisha',
        subject: 'A vendor',
        state: 'awaiting-operator',
      },
    ];
    expect(codeOf(() => parseControlPlaneSnapshotV1(payload))).toBe('snapshot-invalid');
  });

  it('rejects an unavailable series that carries points', () => {
    const payload = mutableSnapshot();
    const sections = payload['sections'] as Record<string, Record<string, unknown>>;
    const series = sectionAt(sections, 'conversationActivity');
    series['points'] = [{ label: '00:00', value: 0 }];
    expect(codeOf(() => parseControlPlaneSnapshotV1(payload))).toBe('snapshot-invalid');
  });

  it('rejects a REPOSITORY_BASELINE that claims REQUEST_TIME freshness', () => {
    // The defect this contract now makes unrepresentable. Serving a request stamps a new envelope;
    // it re-reads nothing. A compiled-in baseline cannot become fresher by being asked for again.
    const payload = mutableSnapshot();
    const source = payload['source'] as Record<string, unknown>;
    source['freshness'] = 'REQUEST_TIME';
    expect(codeOf(() => parseControlPlaneSnapshotV1(payload))).toBe('snapshot-invalid');
  });

  it('rejects a REPOSITORY_BASELINE that claims live operational data', () => {
    const payload = mutableSnapshot();
    const source = payload['source'] as Record<string, unknown>;
    source['liveOperationalData'] = true;
    expect(codeOf(() => parseControlPlaneSnapshotV1(payload))).toBe('snapshot-invalid');
  });

  it('rejects a DEMO_FIXTURE that claims REQUEST_TIME freshness', () => {
    const payload = mutableSnapshot();
    const source = payload['source'] as Record<string, unknown>;
    source['kind'] = 'DEMO_FIXTURE';
    source['freshness'] = 'REQUEST_TIME';
    expect(codeOf(() => parseControlPlaneSnapshotV1(payload))).toBe('snapshot-invalid');
  });

  it('rejects a LIVE_ADAPTER claiming live data it did not read at request time', () => {
    const payload = mutableSnapshot();
    const source = payload['source'] as Record<string, unknown>;
    source['kind'] = 'LIVE_ADAPTER';
    source['liveOperationalData'] = true;
    source['freshness'] = 'BUILD_DECLARATION';
    expect(codeOf(() => parseControlPlaneSnapshotV1(payload))).toBe('snapshot-invalid');
  });

  it('accepts the only honest LIVE_ADAPTER combination', () => {
    // Not aspirational: this proves the invariants forbid the impossible without forbidding the
    // shape a real adapter will need in a later phase.
    const payload = mutableSnapshot();
    const source = payload['source'] as Record<string, unknown>;
    source['kind'] = 'LIVE_ADAPTER';
    source['liveOperationalData'] = true;
    source['freshness'] = 'REQUEST_TIME';
    expect(codeOf(() => parseControlPlaneSnapshotV1(payload))).toBe('no-error-thrown');
  });

  it('has no source-level NOT_CONNECTED freshness — sections own connectivity', () => {
    const payload = mutableSnapshot();
    const source = payload['source'] as Record<string, unknown>;
    source['freshness'] = 'NOT_CONNECTED';
    expect(codeOf(() => parseControlPlaneSnapshotV1(payload))).toBe('snapshot-invalid');
  });

  it('rejects live operational data claimed without a live adapter', () => {
    const payload = mutableSnapshot();
    const source = payload['source'] as Record<string, unknown>;
    source['kind'] = 'DEMO_FIXTURE';
    source['liveOperationalData'] = true;
    expect(codeOf(() => parseControlPlaneSnapshotV1(payload))).toBe('snapshot-invalid');
  });

  it('rejects a roadmap marker without a track', () => {
    const payload = mutableSnapshot();
    const roadmap = payload['roadmap'] as Record<string, unknown>[];
    const first = roadmap[0];
    if (first !== undefined) {
      Reflect.deleteProperty(first, 'track');
    }
    expect(codeOf(() => parseControlPlaneSnapshotV1(payload))).toBe('snapshot-invalid');
  });

  it('rejects duplicate agent ids', () => {
    const payload = mutableSnapshot();
    const agents = payload['agents'] as unknown[];
    const first = agents[0];
    agents.push(structuredClone(first));
    expect(codeOf(() => parseControlPlaneSnapshotV1(payload))).toBe('snapshot-invalid');
  });

  it('requires availability, reason and expectedSource on every section', () => {
    for (const field of ['availability', 'reason', 'expectedSource']) {
      const payload = mutableSnapshot();
      const sections = payload['sections'] as Record<string, Record<string, unknown>>;
      const queue = sectionAt(sections, 'approvalQueue');
      Reflect.deleteProperty(queue, field);
      expect(
        codeOf(() => parseControlPlaneSnapshotV1(payload)),
        field,
      ).toBe('snapshot-invalid');
    }
  });

  it('requires the source block and rejects an unknown source kind', () => {
    const missing = mutableSnapshot();
    delete missing['source'];
    expect(codeOf(() => parseControlPlaneSnapshotV1(missing))).toBe('snapshot-invalid');

    const unknown = mutableSnapshot();
    (unknown['source'] as Record<string, unknown>)['kind'] = 'PRODUCTION_DATABASE';
    expect(codeOf(() => parseControlPlaneSnapshotV1(unknown))).toBe('snapshot-invalid');
  });
});

describe('bounds', () => {
  it('rejects an over-long sentence', () => {
    const payload = mutableSnapshot();
    const system = payload['system'] as Record<string, unknown>[];
    const first = system[0];
    if (first !== undefined) {
      first['detail'] = 'x'.repeat(241);
    }
    expect(codeOf(() => parseControlPlaneSnapshotV1(payload))).toBe('snapshot-invalid');
  });

  it('rejects an over-long array', () => {
    const payload = mutableSnapshot();
    const agents = payload['agents'] as unknown[];
    const first = agents[0] as Record<string, unknown>;
    // 9 agents against a max of 8. Ids must stay unique, so vary them; the id enum caps this
    // anyway, which is the belt-and-braces point.
    payload['agents'] = Array.from({ length: 9 }, () => structuredClone(first));
    expect(codeOf(() => parseControlPlaneSnapshotV1(payload))).toBe('snapshot-invalid');
  });

  it('rejects a non-finite or negative series value', () => {
    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1_000_000_001]) {
      const payload = mutableSnapshot();
      const sections = payload['sections'] as Record<string, Record<string, unknown>>;
      const series = sectionAt(sections, 'conversationActivity');
      series['availability'] = 'STATIC_BASELINE';
      series['points'] = [{ label: '00:00', value }];
      expect(
        codeOf(() => parseControlPlaneSnapshotV1(payload)),
        String(value),
      ).toBe('snapshot-invalid');
    }
  });
});

describe('the error taxonomy', () => {
  it('is a closed set of exactly three normalized codes', () => {
    expect([...CONTROL_PLANE_READ_CONTRACT_ERROR_CODES]).toEqual([
      'snapshot-malformed',
      'snapshot-invalid',
      'contract-version-unsupported',
    ]);
  });

  it('never leaks the received value into the message', () => {
    const payload = mutableSnapshot();
    payload['generatedAt'] = 'super-secret-token-value';
    try {
      parseControlPlaneSnapshotV1(payload);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ControlPlaneReadContractError);
      const contractError = error as ControlPlaneReadContractError;
      expect(contractError.message).toBe('control-plane snapshot does not satisfy contract v1');
      expect(contractError.message).not.toContain('super-secret-token-value');
      // Issues name the PATH, never the value.
      for (const issue of contractError.issues) {
        expect(issue.message).not.toContain('super-secret-token-value');
      }
      expect(contractError.issues.some((issue) => issue.path === 'generatedAt')).toBe(true);
    }
  });

  it('is frozen, so a handler cannot rewrite a failure it received', () => {
    const error = new ControlPlaneReadContractError('snapshot-invalid', [
      { path: 'a', message: 'b' },
    ]);
    expect(Object.isFrozen(error)).toBe(true);
    expect(Object.isFrozen(error.issues)).toBe(true);
  });
});

describe('immutability', () => {
  it('returns a deeply frozen result', () => {
    const parsed = parseControlPlaneSnapshotV1(validSnapshot());
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.sections)).toBe(true);
    expect(Object.isFrozen(parsed.sections.approvalQueue)).toBe(true);
    expect(Object.isFrozen(parsed.agents)).toBe(true);
    expect(Object.isFrozen(parsed.agents[0])).toBe(true);
  });

  it('detaches from the caller, so mutating the input cannot alter the retained result', () => {
    const input = mutableSnapshot();
    const parsed = parseControlPlaneSnapshotV1(input);
    const before = parsed.agents[0]?.name;

    // The caller keeps its reference and rewrites it afterwards.
    const agents = input['agents'] as Record<string, unknown>[];
    const first = agents[0];
    if (first !== undefined) {
      first['name'] = 'Rewritten';
    }
    (input['rollout'] as Record<string, unknown>)['enabled'] = true;

    expect(parsed.agents[0]?.name).toBe(before);
    expect(parsed.rollout.enabled).toBe(false);
  });
});

describe('the package root API', () => {
  it('exports exactly four runtime symbols', async () => {
    const barrel = (await import('../index.js')) as unknown as Record<string, unknown>;
    expect(Object.keys(barrel).sort()).toEqual([
      'CONTROL_PLANE_READ_CONTRACT_ERROR_CODES',
      'CONTROL_PLANE_READ_CONTRACT_VERSION',
      'ControlPlaneReadContractError',
      'parseControlPlaneSnapshotV1',
    ]);
  });
});

/**
 * The Aarohi funnel and readiness surface (AVG-11, ADR-0128).
 *
 * The rule these cases exist for is one sentence: a read contract must not be able to publish a
 * QuickFurno business outcome, and must not be able to render an unread source as a zero.
 */
describe('the Aarohi acquisition funnel', () => {
  /** A readable funnel section carrying the supplied stages. */
  const withFunnel = (stages: readonly unknown[]): Record<string, unknown> => {
    const payload = mutableSnapshot();
    const sections = payload['sections'] as Record<string, Record<string, unknown>>;
    const funnel = sectionAt(sections, 'vendorGrowthFunnel');
    funnel['availability'] = 'STATIC_BASELINE';
    funnel['items'] = [...stages];
    return payload;
  };

  const workflowStage = {
    id: 'registration-assistance-prepared',
    label: 'Registration assistance prepared',
    authority: 'JARVIS_WORKFLOW_DERIVED',
    value: 3,
    caption: 'A brief was prepared. Nobody registered.',
  };

  const unavailableStage = {
    id: 'core-active-handoff-confirmed',
    label: 'Core ACTIVE handoff confirmed',
    authority: 'AUTHORITY_UNAVAILABLE',
    expectedAuthority: 'CORE_AUTHORITATIVE',
    caption: 'QuickFurno Core is not connected, so this is unknown rather than none.',
  };

  it('accepts a workflow-derived count and an unavailable stage side by side', () => {
    const parsed = parseControlPlaneSnapshotV1(withFunnel([workflowStage, unavailableStage]));
    const stages = parsed.sections.vendorGrowthFunnel.items;
    expect(stages).toHaveLength(2);
    const terminal = stages[1];
    expect(terminal?.authority).toBe('AUTHORITY_UNAVAILABLE');
    // The property the whole union exists for: there is no value to be misread as zero.
    expect(terminal !== undefined && 'value' in terminal).toBe(false);
  });

  it('refuses a stage id that names a business outcome', () => {
    for (const id of ['registered', 'paid-active', 'active', 'converted', 'contacted']) {
      const payload = withFunnel([{ ...workflowStage, id }]);
      expect(
        codeOf(() => parseControlPlaneSnapshotV1(payload)),
        id,
      ).toBe('snapshot-invalid');
    }
  });

  it('refuses an unavailable stage that smuggles a value back in', () => {
    const payload = withFunnel([{ ...unavailableStage, value: 0 }]);
    expect(codeOf(() => parseControlPlaneSnapshotV1(payload))).toBe('snapshot-invalid');
  });

  it('refuses a readable stage with no value, so a count cannot go missing either', () => {
    const { value: _removed, ...noValue } = workflowStage;
    const payload = withFunnel([noValue]);
    expect(codeOf(() => parseControlPlaneSnapshotV1(payload))).toBe('snapshot-invalid');
  });

  it('refuses a stage claiming an authority its stage does not own', () => {
    // The one that matters: a confirmed Core handoff published as a Jarvis-derived figure.
    const payload = withFunnel([
      {
        id: 'core-active-handoff-confirmed',
        label: 'Core ACTIVE handoff confirmed',
        authority: 'JARVIS_WORKFLOW_DERIVED',
        value: 12,
        caption: 'Claimed by Jarvis, which does not own it.',
      },
    ]);
    expect(codeOf(() => parseControlPlaneSnapshotV1(payload))).toBe('snapshot-invalid');

    // And the reverse: a Jarvis workflow step published as Core-authoritative.
    const reverse = withFunnel([{ ...workflowStage, authority: 'CORE_AUTHORITATIVE' }]);
    expect(codeOf(() => parseControlPlaneSnapshotV1(reverse))).toBe('snapshot-invalid');
  });

  it('refuses an unavailable stage that names the wrong expected authority', () => {
    const payload = withFunnel([
      { ...unavailableStage, expectedAuthority: 'JARVIS_WORKFLOW_DERIVED' },
    ]);
    expect(codeOf(() => parseControlPlaneSnapshotV1(payload))).toBe('snapshot-invalid');
  });

  it('refuses a duplicate stage id, which would hide one of them', () => {
    const payload = withFunnel([workflowStage, { ...workflowStage, value: 99 }]);
    expect(codeOf(() => parseControlPlaneSnapshotV1(payload))).toBe('snapshot-invalid');
  });

  it('refuses a fractional or negative count', () => {
    for (const value of [1.5, -1]) {
      const payload = withFunnel([{ ...workflowStage, value }]);
      expect(
        codeOf(() => parseControlPlaneSnapshotV1(payload)),
        String(value),
      ).toBe('snapshot-invalid');
    }
  });

  it('keeps a PLANNED funnel carrying no stages at all', () => {
    const payload = mutableSnapshot();
    const sections = payload['sections'] as Record<string, Record<string, unknown>>;
    sectionAt(sections, 'vendorGrowthFunnel')['items'] = [workflowStage];
    // Availability stays PLANNED: "unreadable is not empty" still governs the section itself.
    expect(codeOf(() => parseControlPlaneSnapshotV1(payload))).toBe('snapshot-invalid');
  });
});

describe('the Aarohi readiness section', () => {
  const readinessRow = {
    id: 'avg-9-registration-assistance',
    label: 'Registration assistance domain',
    kind: 'offline-domain',
    state: 'PLANNED',
    detail: 'Offline contract merged under ADR-0126. There is no runtime.',
  };

  const withReadiness = (rows: readonly unknown[]): Record<string, unknown> => {
    const payload = mutableSnapshot();
    const sections = payload['sections'] as Record<string, Record<string, unknown>>;
    sectionAt(sections, 'aarohiAcquisitionReadiness')['items'] = [...rows];
    return payload;
  };

  it('accepts a governance-declared readiness row', () => {
    const parsed = parseControlPlaneSnapshotV1(withReadiness([readinessRow]));
    expect(parsed.sections.aarohiAcquisitionReadiness.items[0]?.kind).toBe('offline-domain');
  });

  it('refuses an unknown readiness kind and an unknown field', () => {
    expect(
      codeOf(() =>
        parseControlPlaneSnapshotV1(withReadiness([{ ...readinessRow, kind: 'metric' }])),
      ),
    ).toBe('snapshot-invalid');
    expect(
      codeOf(() => parseControlPlaneSnapshotV1(withReadiness([{ ...readinessRow, value: 4 }]))),
    ).toBe('snapshot-invalid');
  });

  it('carries no count, so a readiness row can never be read as a figure', () => {
    const parsed = parseControlPlaneSnapshotV1(withReadiness([readinessRow]));
    const row = parsed.sections.aarohiAcquisitionReadiness.items[0];
    expect(Object.keys(row ?? {}).sort()).toStrictEqual(['detail', 'id', 'kind', 'label', 'state']);
  });

  it('obeys "unreadable is not empty" like every other section', () => {
    const payload = withReadiness([readinessRow]);
    const sections = payload['sections'] as Record<string, Record<string, unknown>>;
    sectionAt(sections, 'aarohiAcquisitionReadiness')['availability'] = 'NOT_CONNECTED';
    expect(codeOf(() => parseControlPlaneSnapshotV1(payload))).toBe('snapshot-invalid');
  });
});
