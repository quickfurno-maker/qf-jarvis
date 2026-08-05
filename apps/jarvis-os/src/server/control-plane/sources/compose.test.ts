import { describe, expect, it } from 'vitest';

import { buildControlPlaneSnapshot } from '../build-snapshot';
import { baselineSections } from '../repository-baseline';

import { ReadSourceCompositionError, composeSections } from './compose';
import {
  ADOPTED_READ_SOURCES,
  SECTIONS_CLOSED_TO_ADAPTERS,
  type ControlPlaneReadSource,
  type ReadSourceResult,
} from './read-source';

/**
 * Progressive read-source composition (JOS-01E, ADR-0089).
 *
 * Every source here is a deterministic in-memory fake. That is the point of the phase: the
 * mechanism has to be provable before anything real depends on it, and no adapter is adopted in
 * this release — `ADOPTED_READ_SOURCES` is empty because nothing in merged `main` can be read from
 * inside Jarvis OS without managed-database credentials or a protocol that has not been adopted.
 *
 * So these tests exercise the machinery, and the assertions about the DEFAULT snapshot prove the
 * machinery changed nothing an operator sees.
 */

const AT = '2026-08-04T12:00:00.000Z';
const OBSERVED_AT = '2026-08-04T11:59:00.000Z';

const metric = (id: string) => ({
  id,
  label: 'Observed metric',
  value: '7',
  caption: 'Read from a deterministic test source.',
});

const source = (
  id: string,
  owns: ControlPlaneReadSource['owns'],
  result: ReadSourceResult | (() => never),
): ControlPlaneReadSource => ({
  id,
  label: `Test source ${id}`,
  owns,
  read: typeof result === 'function' ? result : () => result,
});

const observing = (id: string, owns: ControlPlaneReadSource['owns']): ControlPlaneReadSource =>
  source(id, owns, {
    status: 'OBSERVED',
    observedAt: OBSERVED_AT,
    sections: Object.fromEntries(
      owns.map((name) => [
        name,
        {
          reason: 'Read from a deterministic test source.',
          expectedSource: `Test source ${id}`,
          items: [metric(`${id}-row`)],
        },
      ]),
    ),
  });

describe('the adopted registry', () => {
  it('adopts no source in this release', () => {
    // Not a placeholder: nothing in merged main is reachable from Jarvis OS without crossing a
    // boundary this phase may not cross. Inventing one would be the only way to make it non-empty.
    expect(ADOPTED_READ_SOURCES).toHaveLength(0);
  });

  it('leaves the default snapshot exactly as the repository baseline', () => {
    const snapshot = buildControlPlaneSnapshot({ generatedAt: AT });
    expect(snapshot.source.kind).toBe('REPOSITORY_BASELINE');
    expect(snapshot.source.freshness).toBe('BUILD_DECLARATION');
    expect(snapshot.source.liveOperationalData).toBe(false);
    // Identical to composing explicitly with no sources: the default path takes no shortcut.
    expect(snapshot).toStrictEqual(buildControlPlaneSnapshot({ generatedAt: AT, sources: [] }));
  });
});

describe('composition determinism', () => {
  it('produces identical output for identical inputs', () => {
    const build = (): unknown =>
      buildControlPlaneSnapshot({
        generatedAt: AT,
        sources: [observing('s1', ['headlineMetrics'])],
      });
    expect(build()).toStrictEqual(build());
  });

  it('leaves every section no source owns exactly as the baseline declared it', () => {
    const baseline = baselineSections();
    const { sections } = composeSections(baseline, [observing('s1', ['headlineMetrics'])]);
    for (const [name, section] of Object.entries(sections)) {
      if (name === 'headlineMetrics') continue;
      expect(section, name).toStrictEqual(baseline[name as keyof typeof baseline]);
    }
  });
});

describe('provenance and freshness', () => {
  it('moves the source block only when something was genuinely observed', () => {
    const observedSnapshot = buildControlPlaneSnapshot({
      generatedAt: AT,
      sources: [observing('s1', ['headlineMetrics'])],
    });
    expect(observedSnapshot.source.kind).toBe('LIVE_ADAPTER');
    expect(observedSnapshot.source.freshness).toBe('REQUEST_TIME');
    expect(observedSnapshot.source.liveOperationalData).toBe(true);
  });

  it('does NOT let generatedAt manufacture freshness', () => {
    // The JOS-01B rule, still holding. A later envelope instant re-reads nothing, so a snapshot
    // with no observing source stays BUILD_DECLARATION however recent its timestamp is.
    for (const instant of [AT, '2030-01-01T00:00:00.000Z']) {
      const snapshot = buildControlPlaneSnapshot({ generatedAt: instant, sources: [] });
      expect(snapshot.generatedAt).toBe(instant);
      expect(snapshot.source.freshness).toBe('BUILD_DECLARATION');
      expect(snapshot.source.liveOperationalData).toBe(false);
    }
  });

  it('names the system that was actually read on an observed section', () => {
    const snapshot = buildControlPlaneSnapshot({
      generatedAt: AT,
      sources: [observing('s1', ['headlineMetrics'])],
    });
    expect(snapshot.sections.headlineMetrics.availability).toBe('AVAILABLE');
    expect(snapshot.sections.headlineMetrics.expectedSource).toBe('Test source s1');
    expect(snapshot.sections.headlineMetrics.items).toHaveLength(1);
  });
});

describe('failure never becomes a successful zero', () => {
  it('degrades ONLY the failing source’s sections, and drops their rows', () => {
    const failing = source('down', ['headlineMetrics', 'attention'], {
      status: 'UNAVAILABLE',
      reason: 'The test source reported itself unreadable.',
    });
    const snapshot = buildControlPlaneSnapshot({ generatedAt: AT, sources: [failing] });

    for (const name of ['headlineMetrics', 'attention'] as const) {
      const section = snapshot.sections[name];
      // NOT_CONNECTED with zero rows -- never AVAILABLE with zero rows, which reads to an operator
      // as "we looked and there is nothing waiting for you".
      expect(section.availability, name).toBe('NOT_CONNECTED');
      expect(section.items, name).toHaveLength(0);
    }
    // Untouched sections keep their baseline truth rather than being collateral damage.
    expect(snapshot.sections.models.availability).toBe(baselineSections().models.availability);
    // No observation happened, so the envelope must not claim live data.
    expect(snapshot.source.kind).toBe('REPOSITORY_BASELINE');
    expect(snapshot.source.liveOperationalData).toBe(false);
  });

  it('treats a THROWING source as unavailable and leaks nothing from the exception', () => {
    const secretish = 'postgres://user:pw@db.internal:5432/qf — at /srv/qf-jarvis/secrets';
    const exploding = source('boom', ['headlineMetrics'], () => {
      throw new Error(secretish);
    });
    const snapshot = buildControlPlaneSnapshot({ generatedAt: AT, sources: [exploding] });

    const section = snapshot.sections.headlineMetrics;
    expect(section.availability).toBe('NOT_CONNECTED');
    expect(section.items).toHaveLength(0);
    // The adapter's error text is the most likely place for a host, path, query or token to appear.
    const rendered = JSON.stringify(snapshot);
    for (const fragment of ['postgres://', 'db.internal', '/srv/qf-jarvis/secrets', 'pw@']) {
      expect(rendered, fragment).not.toContain(fragment);
    }
  });

  it('refuses prose a source tries to overflow into an operator’s browser', () => {
    const shouty = source('verbose', ['headlineMetrics'], {
      status: 'UNAVAILABLE',
      reason: 'x'.repeat(5000),
    });
    const section = buildControlPlaneSnapshot({ generatedAt: AT, sources: [shouty] }).sections
      .headlineMetrics;
    expect(section.reason.length).toBeLessThanOrEqual(240);
  });
});

describe('one source cannot overreach another’s authority', () => {
  it('rejects two sources claiming the same section', () => {
    expect(() =>
      composeSections(baselineSections(), [
        observing('a', ['headlineMetrics']),
        observing('b', ['headlineMetrics']),
      ]),
    ).toThrow(ReadSourceCompositionError);
  });

  it('rejects duplicate source ids', () => {
    expect(() =>
      composeSections(baselineSections(), [
        observing('same', ['headlineMetrics']),
        observing('same', ['attention']),
      ]),
    ).toThrow(ReadSourceCompositionError);
  });

  it('rejects a contribution for a section the source does not own', () => {
    const sneaky = source('sneaky', ['headlineMetrics'], {
      status: 'OBSERVED',
      observedAt: OBSERVED_AT,
      sections: {
        headlineMetrics: {
          reason: 'ok',
          expectedSource: 'test',
          items: [metric('fine')],
        },
        approvalQueue: {
          reason: 'not mine',
          expectedSource: 'test',
          items: [],
        },
      },
    });
    expect(() => composeSections(baselineSections(), [sneaky])).toThrow(ReadSourceCompositionError);
  });

  it('refuses any adapter that claims a section closed to adapters', () => {
    // `coreSync` states which records QuickFurno Core owns. A Jarvis adapter rewriting it would let
    // Jarvis re-describe the authority boundary it is subject to.
    expect(SECTIONS_CLOSED_TO_ADAPTERS).toContain('coreSync');
    for (const closed of SECTIONS_CLOSED_TO_ADAPTERS) {
      expect(() => composeSections(baselineSections(), [observing('greedy', [closed])])).toThrow(
        ReadSourceCompositionError,
      );
    }
  });
});

describe('the boundary a source can never cross', () => {
  it('cannot switch production rollout on', () => {
    const snapshot = buildControlPlaneSnapshot({
      generatedAt: AT,
      sources: [observing('s1', ['headlineMetrics'])],
    });
    // Structural, not policed: `rollout.enabled` is a `z.literal(false)` in the contract, so a
    // snapshot claiming otherwise cannot be parsed at all -- by any client, on any platform.
    expect(snapshot.rollout.enabled).toBe(false);
    expect(snapshot.rollout.state).toBe('ROLLOUT_OFF');
  });

  it('cannot claim business authority for Jarvis', () => {
    const snapshot = buildControlPlaneSnapshot({
      generatedAt: AT,
      sources: [observing('s1', ['headlineMetrics'])],
    });
    expect(snapshot.authority.jarvis).toBe('RECOMMENDS_AND_OBSERVES');
    expect(snapshot.authority.quickfurnoCore).toBe('AUTHORIZES_AND_OWNS_BUSINESS_TRUTH');
    expect(snapshot.authority.n8n).toBe('EXECUTES_ONLY');
  });

  it('keeps Core and n8n NOT_CONNECTED with an adopted source present', () => {
    const snapshot = buildControlPlaneSnapshot({
      generatedAt: AT,
      sources: [observing('s1', ['headlineMetrics'])],
    });
    // No adopted protocol exists for either, so observing something else must not change them.
    //
    // The two are asserted differently on purpose. Core's DATA is unreadable, so those sections are
    // NOT_CONNECTED with no rows. `coreSync` is not Core data — it is the repository's declaration
    // of which records Core owns, which is STATIC_BASELINE and legitimately carries rows. Asserting
    // NOT_CONNECTED there would have been asserting a falsehood.
    expect(snapshot.sections.businessAnalytics.availability).toBe('NOT_CONNECTED');
    expect(snapshot.sections.businessAnalytics.items).toHaveLength(0);
    expect(snapshot.sections.n8nExecution.availability).toBe('NOT_CONNECTED');
    expect(snapshot.sections.n8nExecution.items).toHaveLength(0);
    // And the ownership declaration itself is byte-identical to the baseline: an adapter observing
    // an unrelated section cannot restate who owns business truth.
    expect(snapshot.sections.coreSync).toStrictEqual(baselineSections().coreSync);
  });

  it('exposes no mutation or authority vocabulary on the source contract', () => {
    const fake = observing('s1', ['headlineMetrics']);
    for (const forbidden of [
      'send',
      'execute',
      'approve',
      'write',
      'update',
      'delete',
      'mutate',
      'canExecute',
      'canSend',
      'isAuthorized',
    ]) {
      expect(Object.keys(fake), forbidden).not.toContain(forbidden);
    }
    expect(Object.keys(fake).sort()).toStrictEqual(['id', 'label', 'owns', 'read']);
  });
});
