/**
 * The V2 contract, and V1/V2 compatibility (AVG-11, ADR-0129).
 *
 * ### What this suite is really defending
 *
 * ADR-0086 wrote the rule down: `contractVersion` is `"1"`, and a breaking change to the snapshot
 * shape requires a NEW VERSION and a superseding ADR, not an edit in place — because a shipped
 * Android client cannot be asked to re-parse.
 *
 * AVG-11 needed two breaking changes. So the compatibility half of this file matters more than the
 * V2 half: it proves that a payload produced before AVG-11 existed still parses, that V1 never
 * acquired the new section, and that the two versions refuse each other cleanly rather than
 * half-accepting.
 */
import { describe, expect, it } from 'vitest';

import {
  CONTROL_PLANE_READ_CONTRACT_V2_VERSION,
  CONTROL_PLANE_READ_CONTRACT_VERSION,
  ControlPlaneReadContractError,
  parseControlPlaneSnapshotV1,
  parseControlPlaneSnapshotV2,
} from '../index.js';
import { mutableSnapshot, validSnapshot } from './fixtures.js';
import { mutableSnapshotV2, validSnapshotV2 } from './fixtures-v2.js';
import { GOLDEN_V1_SNAPSHOT_PRE_AVG11 } from './golden-v1-snapshot.js';

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

// ===========================================================================
// V1 compatibility. The half that ADR-0086's change-control rule is about.
// ===========================================================================

describe('V1 is unchanged by AVG-11', () => {
  it('still parses a GOLDEN snapshot captured before AVG-11 existed', () => {
    // A frozen literal typed `unknown`, so it does not track the current types and therefore CAN
    // fail. If this stops parsing, a shipped client stopped being able to read its own contract.
    const parsed = parseControlPlaneSnapshotV1(GOLDEN_V1_SNAPSHOT_PRE_AVG11);
    expect(parsed.contractVersion).toBe('1');
    expect(parsed.sections.vendorGrowthFunnel.items).toHaveLength(5);
  });

  it('still accepts the OLD generic funnel stage shape, including ids V2 refuses', () => {
    const parsed = parseControlPlaneSnapshotV1(GOLDEN_V1_SNAPSHOT_PRE_AVG11);
    const ids = parsed.sections.vendorGrowthFunnel.items.map((stage) => stage.id);
    // `registered` and `paid-active` are exactly what AVG-11 concluded a Jarvis surface must never
    // publish. V1 accepted them before AVG-11 and must go on accepting them.
    expect(ids).toContain('registered');
    expect(ids).toContain('paid-active');
    for (const stage of parsed.sections.vendorGrowthFunnel.items) {
      expect(stage.value, stage.id).toBe(0);
      // No authority discriminant exists at V1, and none was smuggled in.
      expect('authority' in stage, stage.id).toBe(false);
    }
  });

  it('does not require the AVG-11 readiness section', () => {
    const parsed = parseControlPlaneSnapshotV1(GOLDEN_V1_SNAPSHOT_PRE_AVG11);
    expect('aarohiAcquisitionReadiness' in parsed.sections).toBe(false);
    // And the current V1 fixture -- which is byte-for-byte the pre-AVG-11 one -- parses too.
    expect(parseControlPlaneSnapshotV1(validSnapshot()).contractVersion).toBe('1');
  });

  it('REFUSES the AVG-11 readiness section, because V1 sections are strict', () => {
    const payload = mutableSnapshot();
    const sections = payload['sections'] as Record<string, unknown>;
    sections['aarohiAcquisitionReadiness'] = {
      availability: 'STATIC_BASELINE',
      reason: 'Declared by merged Aarohi governance.',
      expectedSource: 'The QVGE offline domains.',
      items: [],
    };
    // This is the point of the version boundary: a V2-shaped payload is not a lenient V1 payload.
    expect(codeOf(() => parseControlPlaneSnapshotV1(payload))).toBe('snapshot-invalid');
  });

  it('REFUSES a V2-shaped funnel stage', () => {
    const payload = mutableSnapshot();
    const sections = payload['sections'] as Record<string, Record<string, unknown>>;
    const funnel = sectionAt(sections, 'vendorGrowthFunnel');
    funnel['availability'] = 'STATIC_BASELINE';
    funnel['items'] = [
      {
        id: 'registration-assistance-prepared',
        label: 'Registration assistance prepared',
        authority: 'JARVIS_WORKFLOW_DERIVED',
        value: 3,
        caption: 'A brief was prepared. Nobody registered.',
      },
    ];
    expect(codeOf(() => parseControlPlaneSnapshotV1(payload))).toBe('snapshot-invalid');
  });

  it('reports a V2 payload as a VERSION mismatch, not as a field list', () => {
    expect(codeOf(() => parseControlPlaneSnapshotV1(validSnapshotV2()))).toBe(
      'contract-version-unsupported',
    );
  });
});

// ===========================================================================
// V2.
// ===========================================================================

describe('the V2 contract version', () => {
  it('is exactly "2", and V1 is still exactly "1"', () => {
    expect(CONTROL_PLANE_READ_CONTRACT_V2_VERSION).toBe('2');
    expect(CONTROL_PLANE_READ_CONTRACT_VERSION).toBe('1');
  });

  it('parses its own fixture and freezes the result', () => {
    const parsed = parseControlPlaneSnapshotV2(validSnapshotV2());
    expect(parsed.contractVersion).toBe('2');
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.sections)).toBe(true);
  });

  it('reports a V1 payload as a VERSION mismatch, not as a field list', () => {
    expect(codeOf(() => parseControlPlaneSnapshotV2(validSnapshot()))).toBe(
      'contract-version-unsupported',
    );
    expect(codeOf(() => parseControlPlaneSnapshotV2(GOLDEN_V1_SNAPSHOT_PRE_AVG11))).toBe(
      'contract-version-unsupported',
    );
  });

  it('rejects a non-object payload before anything else', () => {
    for (const payload of [null, undefined, 'v2', 42, []]) {
      expect(
        codeOf(() => parseControlPlaneSnapshotV2(payload)),
        String(payload),
      ).toBe('snapshot-malformed');
    }
  });

  it('REQUIRES the Aarohi readiness section', () => {
    const payload = mutableSnapshotV2();
    const sections = payload['sections'] as Record<string, unknown>;
    Reflect.deleteProperty(sections, 'aarohiAcquisitionReadiness');
    expect(codeOf(() => parseControlPlaneSnapshotV2(payload))).toBe('snapshot-invalid');
  });
});

describe('the V2 Aarohi acquisition funnel', () => {
  const withFunnel = (stages: readonly unknown[]): Record<string, unknown> => {
    const payload = mutableSnapshotV2();
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
    const parsed = parseControlPlaneSnapshotV2(withFunnel([workflowStage, unavailableStage]));
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
        codeOf(() => parseControlPlaneSnapshotV2(payload)),
        id,
      ).toBe('snapshot-invalid');
    }
  });

  it('refuses an unavailable stage that smuggles a value back in', () => {
    const payload = withFunnel([{ ...unavailableStage, value: 0 }]);
    expect(codeOf(() => parseControlPlaneSnapshotV2(payload))).toBe('snapshot-invalid');
  });

  it('refuses a readable stage with no value, so a count cannot go missing either', () => {
    const { value: _removed, ...noValue } = workflowStage;
    expect(codeOf(() => parseControlPlaneSnapshotV2(withFunnel([noValue])))).toBe(
      'snapshot-invalid',
    );
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
    expect(codeOf(() => parseControlPlaneSnapshotV2(payload))).toBe('snapshot-invalid');

    // And the reverse: a Jarvis workflow step published as Core-authoritative.
    const reverse = withFunnel([{ ...workflowStage, authority: 'CORE_AUTHORITATIVE' }]);
    expect(codeOf(() => parseControlPlaneSnapshotV2(reverse))).toBe('snapshot-invalid');
  });

  it('refuses an unavailable stage that names the wrong expected authority', () => {
    const payload = withFunnel([
      { ...unavailableStage, expectedAuthority: 'JARVIS_WORKFLOW_DERIVED' },
    ]);
    expect(codeOf(() => parseControlPlaneSnapshotV2(payload))).toBe('snapshot-invalid');
  });

  it('refuses a duplicate stage id, which would hide one of them', () => {
    const payload = withFunnel([workflowStage, { ...workflowStage, value: 99 }]);
    expect(codeOf(() => parseControlPlaneSnapshotV2(payload))).toBe('snapshot-invalid');
  });

  it('refuses a fractional or negative count', () => {
    for (const value of [1.5, -1]) {
      expect(
        codeOf(() => parseControlPlaneSnapshotV2(withFunnel([{ ...workflowStage, value }]))),
        String(value),
      ).toBe('snapshot-invalid');
    }
  });

  it('keeps a PLANNED funnel carrying no stages at all', () => {
    const payload = mutableSnapshotV2();
    const sections = payload['sections'] as Record<string, Record<string, unknown>>;
    sectionAt(sections, 'vendorGrowthFunnel')['items'] = [workflowStage];
    // Availability stays PLANNED: "unreadable is not empty" still governs the section itself.
    expect(codeOf(() => parseControlPlaneSnapshotV2(payload))).toBe('snapshot-invalid');
  });
});

describe('the V2 Aarohi readiness section', () => {
  const readinessRow = {
    id: 'avg-9-registration-assistance',
    label: 'Registration assistance domain',
    kind: 'offline-domain',
    state: 'PLANNED',
    detail: 'Offline contract merged under ADR-0126. There is no runtime.',
  };

  const withReadiness = (rows: readonly unknown[]): Record<string, unknown> => {
    const payload = mutableSnapshotV2();
    const sections = payload['sections'] as Record<string, Record<string, unknown>>;
    sectionAt(sections, 'aarohiAcquisitionReadiness')['items'] = [...rows];
    return payload;
  };

  it('accepts a governance-declared readiness row', () => {
    const parsed = parseControlPlaneSnapshotV2(withReadiness([readinessRow]));
    expect(parsed.sections.aarohiAcquisitionReadiness.items[0]?.kind).toBe('offline-domain');
  });

  it('refuses an unknown readiness kind and an unknown field', () => {
    expect(
      codeOf(() =>
        parseControlPlaneSnapshotV2(withReadiness([{ ...readinessRow, kind: 'metric' }])),
      ),
    ).toBe('snapshot-invalid');
    expect(
      codeOf(() => parseControlPlaneSnapshotV2(withReadiness([{ ...readinessRow, value: 4 }]))),
    ).toBe('snapshot-invalid');
  });

  it('carries no count, so a readiness row can never be read as a figure', () => {
    const parsed = parseControlPlaneSnapshotV2(withReadiness([readinessRow]));
    const row = parsed.sections.aarohiAcquisitionReadiness.items[0];
    expect(Object.keys(row ?? {}).sort()).toStrictEqual(['detail', 'id', 'kind', 'label', 'state']);
  });

  it('obeys "unreadable is not empty" like every other section', () => {
    const payload = withReadiness([readinessRow]);
    const sections = payload['sections'] as Record<string, Record<string, unknown>>;
    sectionAt(sections, 'aarohiAcquisitionReadiness')['availability'] = 'NOT_CONNECTED';
    expect(codeOf(() => parseControlPlaneSnapshotV2(payload))).toBe('snapshot-invalid');
  });
});

// ===========================================================================
// The invariants V2 restates from V1, driven through BOTH parsers.
// ===========================================================================

describe('V1 and V2 agree on every invariant V2 restates', () => {
  /** Apply one mutation to both fixtures and require both parsers to refuse. */
  const bothRefuse = (label: string, mutate: (payload: Record<string, unknown>) => void): void => {
    const v1 = mutableSnapshot();
    const v2 = mutableSnapshotV2();
    mutate(v1);
    mutate(v2);
    expect(
      codeOf(() => parseControlPlaneSnapshotV1(v1)),
      `${label} (v1)`,
    ).toBe('snapshot-invalid');
    expect(
      codeOf(() => parseControlPlaneSnapshotV2(v2)),
      `${label} (v2)`,
    ).toBe('snapshot-invalid');
  };

  it('refuses an unreadable section carrying rows, at both versions', () => {
    bothRefuse('unearned items', (payload) => {
      const sections = payload['sections'] as Record<string, Record<string, unknown>>;
      const queue = sectionAt(sections, 'approvalQueue');
      queue['items'] = [
        {
          id: 'row-one',
          requestedAction: 'Send a message',
          risk: 'client-or-vendor-facing',
          requestedAuthority: 'authorized-team-human',
          sourceAgent: 'Riya',
          subject: 'A subject',
          state: 'awaiting-operator',
        },
      ];
    });
  });

  it('refuses live operational data from a compiled-in baseline, at both versions', () => {
    bothRefuse('live from baseline', (payload) => {
      (payload['source'] as Record<string, unknown>)['liveOperationalData'] = true;
    });
  });

  it('refuses a REPOSITORY_BASELINE claiming REQUEST_TIME freshness, at both versions', () => {
    bothRefuse('baseline freshness', (payload) => {
      (payload['source'] as Record<string, unknown>)['freshness'] = 'REQUEST_TIME';
    });
  });

  it('refuses duplicate agent ids, at both versions', () => {
    bothRefuse('duplicate agents', (payload) => {
      const agents = payload['agents'] as unknown[];
      const first = agents[0];
      agents.push(structuredClone(first));
    });
  });

  it('refuses rollout claiming to be enabled, at both versions', () => {
    bothRefuse('rollout enabled', (payload) => {
      (payload['rollout'] as Record<string, unknown>)['enabled'] = true;
    });
  });

  it('refuses an unknown top-level field, at both versions', () => {
    bothRefuse('unknown field', (payload) => {
      payload['canSend'] = true;
    });
  });
});

// ===========================================================================
// The surface, at both versions.
// ===========================================================================

describe('neither version can express authority or a write', () => {
  it('carries no permission field a client could act on', () => {
    for (const parsed of [
      JSON.stringify(parseControlPlaneSnapshotV1(validSnapshot())),
      JSON.stringify(parseControlPlaneSnapshotV2(validSnapshotV2())),
    ]) {
      for (const forbidden of [
        'canSend',
        'canExecute',
        'isAuthorized',
        'consentValid',
        'approvalGranted',
        'dispatchAllowed',
      ]) {
        expect(parsed, forbidden).not.toContain(forbidden);
      }
    }
  });

  it('exposes exactly six runtime symbols at the package root', async () => {
    // Four until AVG-11. The two that joined are a version literal and its parser, and the count is
    // asserted so that growing it stays a decision somebody made rather than something that happened.
    const barrel = (await import('../index.js')) as unknown as Record<string, unknown>;
    expect(Object.keys(barrel).sort()).toEqual([
      'CONTROL_PLANE_READ_CONTRACT_ERROR_CODES',
      'CONTROL_PLANE_READ_CONTRACT_V2_VERSION',
      'CONTROL_PLANE_READ_CONTRACT_VERSION',
      'ControlPlaneReadContractError',
      'parseControlPlaneSnapshotV1',
      'parseControlPlaneSnapshotV2',
    ]);
    // No schema, no builder, no mutator escaped to the root.
    for (const name of Object.keys(barrel)) {
      expect(name, name).not.toMatch(/Schema$|^build|^create|^write|^send|^execute/u);
    }
  });
});
