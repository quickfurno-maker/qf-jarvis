import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildControlPlaneSnapshot } from '../build-snapshot';
import { loadControlPlaneSnapshot } from '../load-snapshot';
import { mapSnapshotToReadModel } from '../map-to-ui-model';
import { baselineSections } from '../repository-baseline';

import { ReadSourceCompositionError, composeSections, type ObservationWindow } from './compose';
import {
  ADOPTED_READ_SOURCES,
  SECTIONS_CLOSED_TO_ADAPTERS,
  type CollectedObservation,
  type ControlPlaneSectionName,
  type ReadSourceDescriptor,
  type ReadSourceResult,
  type SectionContributions,
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

const STARTED = '2026-08-04T12:00:00.000Z';
const OBSERVED = '2026-08-04T12:00:00.500Z';
const GENERATED = '2026-08-04T12:00:01.000Z';
const WINDOW: ObservationWindow = { requestStartedAt: STARTED, generatedAt: GENERATED };

const metric = (id: string) => ({
  id,
  label: 'Observed metric',
  value: '7',
  caption: 'Read from a deterministic test source.',
});

const point = (label: string, value: number) => ({ label, value });

/**
 * A promise executor that deliberately never resolves or rejects.
 *
 * The exact liveness hazard the loader's timeout exists for: an adapter that simply stops
 * responding, rather than one that fails.
 */
function neverSettles(): void {
  // Intentionally empty: settling would defeat the test.
}

function descriptor(
  id: string,
  owns: readonly ControlPlaneSectionName[],
  acquire: (signal: AbortSignal) => ReadSourceResult | Promise<ReadSourceResult>,
  timeoutMs = 1_000,
): ReadSourceDescriptor {
  return {
    id,
    label: `Test source ${id}`,
    observedReason: `Read by test source ${id}.`,
    owns,
    timeoutMs,
    acquire,
  };
}

/** A descriptor whose acquire returns a deliberately malformed runtime value. */
function malformed(
  id: string,
  owns: readonly ControlPlaneSectionName[],
  raw: unknown,
): ReadSourceDescriptor {
  return descriptor(id, owns, () => raw as ReadSourceResult);
}

const observed = (observedAt: string, sections: SectionContributions): ReadSourceResult => ({
  status: 'OBSERVED',
  observedAt,
  sections,
});

/** Pair a descriptor with a result, as the request boundary would. */
const collect = (
  d: ReadSourceDescriptor,
  result: ReadSourceResult,
): readonly CollectedObservation[] => [{ descriptor: d, result }];

/** Build through the pure builder with an explicit window. */
const build = (collected: readonly CollectedObservation[]) =>
  buildControlPlaneSnapshot({
    generatedAt: GENERATED,
    requestStartedAt: STARTED,
    collected,
  });

describe('the adopted registry', () => {
  it('adopts no source in this release', () => {
    // Not a placeholder: nothing in merged main is reachable from Jarvis OS without crossing a
    // boundary this phase may not cross. Inventing one would be the only way to make it non-empty.
    expect(ADOPTED_READ_SOURCES).toHaveLength(0);
  });

  it('leaves the default snapshot exactly as the repository baseline', () => {
    const snapshot = buildControlPlaneSnapshot({ generatedAt: GENERATED });
    expect(snapshot.source.kind).toBe('REPOSITORY_BASELINE');
    expect(snapshot.source.freshness).toBe('BUILD_DECLARATION');
    expect(snapshot.source.liveOperationalData).toBe(false);
    expect(snapshot).toStrictEqual(build([]));
  });

  it('resolves the empty registry immediately, with no source acquisition', async () => {
    const loaded = await loadControlPlaneSnapshot();
    expect(loaded.source.kind).toBe('REPOSITORY_BASELINE');
    expect(loaded.sections).toStrictEqual(build([]).sections);
  });
});

describe('item sections', () => {
  it('observes rows and marks the section AVAILABLE', () => {
    const d = descriptor('items-ok', ['headlineMetrics'], () =>
      observed(OBSERVED, { headlineMetrics: { items: [metric('a'), metric('b')] } }),
    );
    const section = build(collect(d, d.acquire(new AbortController().signal) as ReadSourceResult))
      .sections.headlineMetrics;
    expect(section.availability).toBe('AVAILABLE');
    expect(section.items).toHaveLength(2);
    // Prose comes from the reviewed descriptor, never from the runtime result.
    expect(section.reason).toBe('Read by test source items-ok.');
    expect(section.expectedSource).toBe('Test source items-ok');
  });

  it('degrades to NOT_CONNECTED with zero rows when unavailable', () => {
    const d = descriptor('items-down', ['headlineMetrics'], () => ({
      status: 'UNAVAILABLE',
      reason: 'SOURCE_UNREACHABLE',
    }));
    const section = build(collect(d, d.acquire(new AbortController().signal) as ReadSourceResult))
      .sections.headlineMetrics;
    expect(section.availability).toBe('NOT_CONNECTED');
    expect(section.items).toHaveLength(0);
  });
});

/**
 * Series sections were previously impossible for an adapter to own.
 *
 * The composer wrote `items` for every section, but `conversationActivity` and `modelLatency`
 * require `id`, `label` and `points`. A source owning either produced a section the strict parser
 * rejected, so the whole snapshot failed and the route answered a generic 503 — the exact opposite
 * of "a governed source may own any permitted section".
 */
describe.each(['conversationActivity', 'modelLatency'] as const)('series section %s', (name) => {
  const points = [point('10:00', 4), point('10:05', 9)];

  it('observes points, stays shape-correct, and the whole snapshot still parses', () => {
    const d = descriptor(`series-${name}`, [name], () =>
      observed(OBSERVED, { [name]: { points } }),
    );
    const snapshot = build(collect(d, d.acquire(new AbortController().signal) as ReadSourceResult));
    const section = snapshot.sections[name];

    expect(section.availability).toBe('AVAILABLE');
    expect(section.points).toStrictEqual(points);
    // Identity fields the contract requires are carried through from the baseline.
    expect(section.id).toBe(baselineSections()[name].id);
    expect(section.label).toBe(baselineSections()[name].label);
    // A series section must never grow an `items` property.
    expect(Object.keys(section)).not.toContain('items');
    expect(snapshot.source.kind).toBe('LIVE_ADAPTER');
  });

  it('degrades to NOT_CONNECTED with zero points, preserving id and label', () => {
    const d = descriptor(`series-down-${name}`, [name], () => ({
      status: 'UNAVAILABLE',
      reason: 'SOURCE_TIMED_OUT',
    }));
    const snapshot = build(collect(d, d.acquire(new AbortController().signal) as ReadSourceResult));
    const section = snapshot.sections[name];

    expect(section.availability).toBe('NOT_CONNECTED');
    expect(section.points).toHaveLength(0);
    expect(section.id).toBe(baselineSections()[name].id);
    expect(section.label).toBe(baselineSections()[name].label);
    expect(Object.keys(section)).not.toContain('items');
  });

  it('leaves every other section untouched', () => {
    const d = descriptor(`series-iso-${name}`, [name], () =>
      observed(OBSERVED, { [name]: { points } }),
    );
    const baseline = baselineSections();
    const { sections } = composeSections(
      baseline,
      collect(d, d.acquire(new AbortController().signal) as ReadSourceResult),
      WINDOW,
    );
    for (const key of Object.keys(sections) as ControlPlaneSectionName[]) {
      if (key === name) continue;
      expect(sections[key], key).toStrictEqual(baseline[key]);
    }
  });
});

/**
 * `observedAt` is load-bearing evidence, not decoration.
 *
 * It used to be required by the type and then never read: any contribution at all raised the whole
 * snapshot to LIVE_ADAPTER / REQUEST_TIME / true, so a source could have returned a year-old or
 * future reading and the payload would still have claimed it was read during the request.
 */
describe('the request observation window', () => {
  const withInstant = (observedAt: string) => {
    const d = descriptor('clock', ['headlineMetrics'], () =>
      observed(observedAt, { headlineMetrics: { items: [metric('a')] } }),
    );
    return build(collect(d, d.acquire(new AbortController().signal) as ReadSourceResult));
  };

  it('accepts an observation inside the window', () => {
    const snapshot = withInstant(OBSERVED);
    expect(snapshot.sections.headlineMetrics.availability).toBe('AVAILABLE');
    expect(snapshot.source.kind).toBe('LIVE_ADAPTER');
    expect(snapshot.source.freshness).toBe('REQUEST_TIME');
    expect(snapshot.source.liveOperationalData).toBe(true);
  });

  it.each([
    ['malformed', 'not-a-timestamp'],
    ['non-canonical', '2026-08-04T12:00:00Z'],
    ['future, after the envelope', '2026-08-04T12:00:02.000Z'],
    ['stale, before the request', '2025-01-01T00:00:00.000Z'],
  ])('REFUSES a %s observedAt and does not claim request-time', (_label, instant) => {
    const snapshot = withInstant(instant);
    // Refused, not downgraded: the rows never enter the snapshot, so REQUEST_TIME stays true of
    // everything that IS present.
    expect(snapshot.sections.headlineMetrics.availability).toBe('NOT_CONNECTED');
    expect(snapshot.sections.headlineMetrics.items).toHaveLength(0);
    expect(snapshot.source.kind).toBe('REPOSITORY_BASELINE');
    expect(snapshot.source.freshness).toBe('BUILD_DECLARATION');
    expect(snapshot.source.liveOperationalData).toBe(false);
  });

  it('does not let one fresh source make another source’s stale data look request-fresh', () => {
    const fresh = descriptor('fresh', ['headlineMetrics'], () =>
      observed(OBSERVED, { headlineMetrics: { items: [metric('fresh')] } }),
    );
    const stale = descriptor('stale', ['attention'], () =>
      observed('2020-01-01T00:00:00.000Z', { attention: { items: [] } }),
    );
    const snapshot = build([
      {
        descriptor: fresh,
        result: fresh.acquire(new AbortController().signal) as ReadSourceResult,
      },
      {
        descriptor: stale,
        result: stale.acquire(new AbortController().signal) as ReadSourceResult,
      },
    ]);

    // The fresh source is honoured; the stale one contributes NOTHING and its section says so.
    expect(snapshot.sections.headlineMetrics.availability).toBe('AVAILABLE');
    expect(snapshot.sections.attention.availability).toBe('NOT_CONNECTED');
    expect(snapshot.sections.attention.items).toHaveLength(0);
    // REQUEST_TIME is therefore true of every row actually present.
    expect(snapshot.source.freshness).toBe('REQUEST_TIME');
  });

  it('still does NOT let generatedAt alone manufacture freshness', () => {
    for (const instant of [GENERATED, '2030-01-01T00:00:00.000Z']) {
      const snapshot = buildControlPlaneSnapshot({ generatedAt: instant });
      expect(snapshot.generatedAt).toBe(instant);
      expect(snapshot.source.freshness).toBe('BUILD_DECLARATION');
      expect(snapshot.source.liveOperationalData).toBe(false);
    }
  });
});

describe('failure never becomes a successful zero', () => {
  it('degrades ONLY the failing source’s sections', () => {
    const d = descriptor('down', ['headlineMetrics', 'attention'], () => ({
      status: 'UNAVAILABLE',
      reason: 'SOURCE_REJECTED_REQUEST',
    }));
    const snapshot = build(collect(d, d.acquire(new AbortController().signal) as ReadSourceResult));

    for (const name of ['headlineMetrics', 'attention'] as const) {
      expect(snapshot.sections[name].availability, name).toBe('NOT_CONNECTED');
      expect(snapshot.sections[name].items, name).toHaveLength(0);
    }
    expect(snapshot.sections.models).toStrictEqual(baselineSections().models);
    expect(snapshot.source.kind).toBe('REPOSITORY_BASELINE');
  });

  it('treats a THROWING source as unavailable and leaks nothing from the exception', async () => {
    const secret = 'postgres://user:pw@db.internal:5432/qf at /srv/qf-jarvis/secrets token=abc123';
    const d = descriptor('boom', ['headlineMetrics'], () => {
      throw new Error(secret);
    });
    const snapshot = await loadControlPlaneSnapshot({ sources: [d] });

    expect(snapshot.sections.headlineMetrics.availability).toBe('NOT_CONNECTED');
    const rendered = JSON.stringify(snapshot);
    for (const fragment of [
      'postgres://',
      'db.internal',
      '/srv/qf-jarvis/secrets',
      'token=',
      'pw@',
    ]) {
      expect(rendered, fragment).not.toContain(fragment);
    }
  });

  it('leaks nothing through an EXPLICIT unavailable result either', async () => {
    // The gap a throwing-source test alone could not catch: an adapter doing
    // `catch (e) { return { status: 'UNAVAILABLE', reason: e.message } }`. A result now carries a
    // CLOSED code, so there is no field for prose to travel in at all.
    const d: ReadSourceDescriptor = {
      id: 'chatty',
      label: 'Test source chatty',
      observedReason: 'Read by test source chatty.',
      owns: ['headlineMetrics'],
      timeoutMs: 1_000,
      acquire: () =>
        ({
          status: 'UNAVAILABLE',
          // Deliberately hostile, and deliberately not a valid code.
          reason: 'postgres://user:pw@db.internal:5432/qf /srv/qf-jarvis/secrets token=abc123',
        }) as unknown as ReadSourceResult,
    };
    const snapshot = await loadControlPlaneSnapshot({ sources: [d] });

    expect(snapshot.sections.headlineMetrics.availability).toBe('NOT_CONNECTED');
    const rendered = JSON.stringify(snapshot);
    for (const fragment of [
      'postgres://',
      'db.internal',
      '/srv/qf-jarvis/secrets',
      'token=',
      'pw@',
      'user:pw',
    ]) {
      expect(rendered, fragment).not.toContain(fragment);
    }
  });

  it('acquisition failure degrades only the owned sections', async () => {
    const bad = descriptor('bad', ['headlineMetrics'], () =>
      Promise.reject(new Error('nope at /srv/qf-jarvis/secrets')),
    );
    const good = descriptor('good', ['attention'], () =>
      Promise.resolve(observed(new Date().toISOString(), { attention: { items: [] } })),
    );
    const snapshot = await loadControlPlaneSnapshot({ sources: [bad, good] });

    expect(snapshot.sections.headlineMetrics.availability).toBe('NOT_CONNECTED');
    expect(snapshot.sections.attention.availability).toBe('AVAILABLE');
    expect(JSON.stringify(snapshot)).not.toContain('/srv/qf-jarvis/secrets');
  });
});

describe('one source cannot overreach another’s authority', () => {
  const ok = (id: string, owns: readonly ControlPlaneSectionName[]) =>
    descriptor(id, owns, () => observed(OBSERVED, {}));

  it('rejects two sources claiming the same section', () => {
    expect(() =>
      composeSections(
        baselineSections(),
        [
          { descriptor: ok('a', ['headlineMetrics']), result: observed(OBSERVED, {}) },
          { descriptor: ok('b', ['headlineMetrics']), result: observed(OBSERVED, {}) },
        ],
        WINDOW,
      ),
    ).toThrow(ReadSourceCompositionError);
  });

  it('rejects duplicate source ids', () => {
    expect(() =>
      composeSections(
        baselineSections(),
        [
          { descriptor: ok('same', ['headlineMetrics']), result: observed(OBSERVED, {}) },
          { descriptor: ok('same', ['attention']), result: observed(OBSERVED, {}) },
        ],
        WINDOW,
      ),
    ).toThrow(ReadSourceCompositionError);
  });

  it('DEGRADES a source that contributes a section it does not own', async () => {
    // The documented classification: a DESCRIPTOR defect is a governance error and throws, because
    // it lives in reviewed code. A RESULT defect degrades, because it is runtime data from a
    // separately compiled adapter -- and refusing the whole snapshot would punish every other
    // section for one adapter's bug. Overreaching at run time is a result defect.
    const sneaky = malformed('sneaky', ['headlineMetrics'], {
      status: 'OBSERVED',
      observedAt: new Date().toISOString(),
      sections: {
        headlineMetrics: { items: [metric('fine')] },
        approvalQueue: { items: [] },
      },
    });
    const snapshot = await loadControlPlaneSnapshot({ sources: [sneaky] });

    expect(snapshot.sections.headlineMetrics.availability).toBe('NOT_CONNECTED');
    expect(snapshot.sections.headlineMetrics.items).toHaveLength(0);
    // The section it reached for is untouched, exactly as the baseline declared it.
    expect(snapshot.sections.approvalQueue).toStrictEqual(baselineSections().approvalQueue);
    expect(snapshot.source.kind).toBe('REPOSITORY_BASELINE');
  });

  it('THROWS on a descriptor whose timeout is outside the reviewed bounds', () => {
    for (const bad of [0, -1, 50, 60_000, 1.5, Number.NaN]) {
      expect(
        () =>
          composeSections(
            baselineSections(),
            [
              {
                descriptor: descriptor(
                  'slow',
                  ['headlineMetrics'],
                  () => observed(OBSERVED, {}),
                  bad,
                ),
                result: observed(OBSERVED, {}),
              },
            ],
            WINDOW,
          ),
        String(bad),
      ).toThrow(ReadSourceCompositionError);
    }
  });

  it('refuses any adapter that claims a section closed to adapters', () => {
    // `coreSync` states which records QuickFurno Core owns. A Jarvis adapter rewriting it would let
    // Jarvis re-describe the authority boundary it is subject to.
    expect(SECTIONS_CLOSED_TO_ADAPTERS).toContain('coreSync');
    for (const closed of SECTIONS_CLOSED_TO_ADAPTERS) {
      expect(() =>
        composeSections(
          baselineSections(),
          [{ descriptor: ok('greedy', [closed]), result: observed(OBSERVED, {}) }],
          WINDOW,
        ),
      ).toThrow(ReadSourceCompositionError);
    }
  });
});

describe('the boundary a source can never cross', () => {
  const live = () => {
    const d = descriptor('live', ['headlineMetrics'], () =>
      observed(OBSERVED, { headlineMetrics: { items: [metric('a')] } }),
    );
    return build(collect(d, d.acquire(new AbortController().signal) as ReadSourceResult));
  };

  it('cannot switch production rollout on', () => {
    // Structural, not policed: `rollout.enabled` is a `z.literal(false)` in the contract, so a
    // snapshot claiming otherwise cannot be parsed at all -- by any client, on any platform.
    expect(live().rollout.enabled).toBe(false);
    expect(live().rollout.state).toBe('ROLLOUT_OFF');
  });

  it('cannot claim business authority for Jarvis', () => {
    expect(live().authority.jarvis).toBe('RECOMMENDS_AND_OBSERVES');
    expect(live().authority.quickfurnoCore).toBe('AUTHORIZES_AND_OWNS_BUSINESS_TRUTH');
    expect(live().authority.n8n).toBe('EXECUTES_ONLY');
  });

  it('keeps Core and n8n unconnected with an adopted source present', () => {
    const snapshot = live();
    // Core's DATA is unreadable, so those sections carry no rows. `coreSync` is not Core data -- it
    // is the repository's declaration of which records Core owns -- so it stays byte-identical.
    expect(snapshot.sections.businessAnalytics.availability).toBe('NOT_CONNECTED');
    expect(snapshot.sections.n8nExecution.availability).toBe('NOT_CONNECTED');
    expect(snapshot.sections.coreSync).toStrictEqual(baselineSections().coreSync);
  });

  it('exposes no mutation or authority vocabulary on the source contract', () => {
    const d = descriptor('shape', ['headlineMetrics'], () => observed(OBSERVED, {}));
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
      expect(Object.keys(d), forbidden).not.toContain(forbidden);
    }
    expect(Object.keys(d).sort()).toStrictEqual([
      'acquire',
      'id',
      'label',
      'observedReason',
      'owns',
      'timeoutMs',
    ]);
  });
});

/**
 * The page and the API must not drift once a source can change.
 *
 * Before this correction the read model was built once at module load, so the API recomposed per
 * request while every page recited whatever was true when the process started. With no live source
 * that was harmless; the moment one is adopted it is a silent divergence.
 */
describe('the request-scoped path shared by pages and the API', () => {
  /** A source whose observation changes on every acquisition. */
  const counting = (): { source: ReadSourceDescriptor; seen: () => number } => {
    let calls = 0;
    return {
      seen: () => calls,
      source: descriptor('counting', ['headlineMetrics'], () => {
        calls += 1;
        return observed(new Date().toISOString(), {
          headlineMetrics: { items: [metric(`read-${String(calls)}`)] },
        });
      }),
    };
  };

  it('gives the read model and the API payload the same observation set', async () => {
    const { source } = counting();
    const apiSnapshot = await loadControlPlaneSnapshot({ sources: [source] });
    const pageSnapshot = await loadControlPlaneSnapshot({ sources: [source] });

    // Same loader, same composer: the two differ only in their envelope instants, never in what a
    // section says or where it came from.
    expect(mapSnapshotToReadModel(pageSnapshot).headlineMetrics().availability).toBe(
      apiSnapshot.sections.headlineMetrics.availability,
    );
    expect(pageSnapshot.sections.headlineMetrics.expectedSource).toBe(
      apiSnapshot.sections.headlineMetrics.expectedSource,
    );
  });

  it('lets a LATER request observe something newer, with no process-lifetime cache', async () => {
    const { source, seen } = counting();
    const first = await loadControlPlaneSnapshot({ sources: [source] });
    const second = await loadControlPlaneSnapshot({ sources: [source] });

    // Acquired again rather than served from a module-level snapshot.
    expect(seen()).toBe(2);
    const firstRow = first.sections.headlineMetrics.items[0];
    const secondRow = second.sections.headlineMetrics.items[0];
    expect(firstRow).toBeDefined();
    expect(secondRow).toBeDefined();
    expect(secondRow).not.toStrictEqual(firstRow);
  });

  it('awaits an ASYNC source, which is what makes a future HTTP adapter adoptable', async () => {
    const async_ = descriptor('async', ['headlineMetrics'], async () => {
      await Promise.resolve();
      return observed(new Date().toISOString(), { headlineMetrics: { items: [metric('async')] } });
    });
    const snapshot = await loadControlPlaneSnapshot({ sources: [async_] });
    expect(snapshot.sections.headlineMetrics.availability).toBe('AVAILABLE');
    expect(snapshot.source.freshness).toBe('REQUEST_TIME');
  });
});

/**
 * A separately compiled adapter can violate its TypeScript declaration at run time.
 *
 * The values below are deliberately cast past the compiler, because that is exactly what a real
 * misbehaving adapter does. Before normalisation, several of these produced the one lie the whole
 * contract exists to prevent: `AVAILABLE` with zero rows, from a source that never supplied a
 * reading — "we looked and there is nothing waiting for you".
 */
describe('malformed OBSERVED results never become an available zero', () => {
  const now = (): string => new Date().toISOString();

  const cases: readonly (readonly [string, ControlPlaneSectionName, unknown])[] = [
    // Wrong family: a series source answering with `items`, and an item source with `points`.
    [
      'series source returning items',
      'conversationActivity',
      { status: 'OBSERVED', sections: { conversationActivity: { items: [] } } },
    ],
    [
      'item source returning points',
      'headlineMetrics',
      { status: 'OBSERVED', sections: { headlineMetrics: { points: [] } } },
    ],
    // Family array entirely absent.
    [
      'series source missing points',
      'modelLatency',
      { status: 'OBSERVED', sections: { modelLatency: {} } },
    ],
    [
      'item source missing items',
      'headlineMetrics',
      { status: 'OBSERVED', sections: { headlineMetrics: {} } },
    ],
    // Present but not an array.
    [
      'non-array items',
      'headlineMetrics',
      { status: 'OBSERVED', sections: { headlineMetrics: { items: 'lots' } } },
    ],
    [
      'non-array points',
      'conversationActivity',
      { status: 'OBSERVED', sections: { conversationActivity: { points: 42 } } },
    ],
    // Envelope defects.
    ['missing sections', 'headlineMetrics', { status: 'OBSERVED' }],
    ['non-object sections', 'headlineMetrics', { status: 'OBSERVED', sections: [] }],
    [
      'unknown status',
      'headlineMetrics',
      { status: 'PROBABLY_FINE', sections: { headlineMetrics: { items: [] } } },
    ],
    ['no status at all', 'headlineMetrics', { sections: { headlineMetrics: { items: [] } } }],
    ['non-object result', 'headlineMetrics', 'OBSERVED'],
    ['null result', 'headlineMetrics', null],
    [
      'non-string observedAt',
      'headlineMetrics',
      {
        status: 'OBSERVED',
        observedAt: 1_754_308_800_000,
        sections: { headlineMetrics: { items: [] } },
      },
    ],
  ];

  it.each(cases)('%s does not become AVAILABLE', async (_label, section, raw) => {
    const withInstant =
      raw !== null && typeof raw === 'object' && 'observedAt' in raw
        ? raw
        : { ...(raw as object), observedAt: now() };
    const source = malformed('broken', [section], typeof raw === 'object' ? withInstant : raw);
    const snapshot = await loadControlPlaneSnapshot({ sources: [source] });
    const composed = snapshot.sections[section];

    expect(composed.availability).toBe('NOT_CONNECTED');
    expect('points' in composed ? composed.points : composed.items).toHaveLength(0);
    // No observation survived, so the envelope must not claim live data.
    expect(snapshot.source.kind).toBe('REPOSITORY_BASELINE');
    expect(snapshot.source.liveOperationalData).toBe(false);
  });

  it('does not crash the whole snapshot on a non-array rows value', async () => {
    const source = malformed('crashy', ['headlineMetrics'], {
      status: 'OBSERVED',
      observedAt: now(),
      sections: { headlineMetrics: { items: { length: 3 } } },
    });
    // Resolves rather than throwing: a spread over a non-array used to be an exception that took
    // the entire page down.
    await expect(loadControlPlaneSnapshot({ sources: [source] })).resolves.toBeDefined();
  });

  it('degrades EVERY owned section when a source answers only some of them', async () => {
    // Silence is not an observation. Leaving the omitted section at repository baseline would show
    // compiled-in figures beneath a snapshot claiming to be live, with nothing saying which
    // sections were actually read.
    const partial = malformed('partial', ['headlineMetrics', 'attention'], {
      status: 'OBSERVED',
      observedAt: now(),
      sections: { headlineMetrics: { items: [] } },
    });
    const snapshot = await loadControlPlaneSnapshot({ sources: [partial] });

    for (const name of ['headlineMetrics', 'attention'] as const) {
      expect(snapshot.sections[name].availability, name).toBe('NOT_CONNECTED');
      expect(snapshot.sections[name].items, name).toHaveLength(0);
    }
    expect(snapshot.source.kind).toBe('REPOSITORY_BASELINE');
  });

  it('degrades ONLY the malformed source’s sections', async () => {
    const broken = malformed('broken', ['headlineMetrics'], { status: 'OBSERVED' });
    const good = descriptor('good', ['attention'], () => ({
      status: 'OBSERVED',
      observedAt: now(),
      sections: { attention: { items: [] } },
    }));
    const snapshot = await loadControlPlaneSnapshot({ sources: [broken, good] });

    expect(snapshot.sections.headlineMetrics.availability).toBe('NOT_CONNECTED');
    expect(snapshot.sections.attention.availability).toBe('AVAILABLE');
    expect(snapshot.sections.models).toStrictEqual(baselineSections().models);
  });

  it('KEEPS an explicitly supplied empty array as a legitimate observation', async () => {
    // The case that must survive all of the above. A source that genuinely looked and found none
    // is different from one that never answered, and only the first may render as zero.
    const empty = descriptor('empty', ['headlineMetrics', 'conversationActivity'], () => ({
      status: 'OBSERVED',
      observedAt: now(),
      sections: { headlineMetrics: { items: [] }, conversationActivity: { points: [] } },
    }));
    const snapshot = await loadControlPlaneSnapshot({ sources: [empty] });

    expect(snapshot.sections.headlineMetrics.availability).toBe('AVAILABLE');
    expect(snapshot.sections.headlineMetrics.items).toHaveLength(0);
    expect(snapshot.sections.conversationActivity.availability).toBe('AVAILABLE');
    expect(snapshot.sections.conversationActivity.points).toHaveLength(0);
    expect(snapshot.source.freshness).toBe('REQUEST_TIME');
  });
});

/**
 * Acquisition is bounded by the LOADER, not by each adapter's good intentions.
 *
 * A rejecting source was always isolated. A source that never settles was not: `Promise.all` waited
 * forever, blocking the page render, the API and every other source's result — while the comments
 * claimed acquisition was bounded and the vocabulary already had `SOURCE_TIMED_OUT`.
 */
describe('bounded acquisition', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Advance the fake clock until the loader's promise settles. */
  const settle = async <T>(promise: Promise<T>): Promise<T> => {
    const raced = promise;
    await vi.advanceTimersByTimeAsync(11_000);
    return raced;
  };

  it('turns a never-settling source into SOURCE_TIMED_OUT and still resolves', async () => {
    let aborted = false;
    const hung = descriptor(
      'hung',
      ['headlineMetrics'],
      (signal) =>
        new Promise<never>(() => {
          signal.addEventListener('abort', () => {
            aborted = true;
          });
        }),
      200,
    );

    const snapshot = await settle(loadControlPlaneSnapshot({ sources: [hung] }));

    expect(snapshot.sections.headlineMetrics.availability).toBe('NOT_CONNECTED');
    // The reviewed prose for the timeout code, not an adapter's words.
    expect(snapshot.sections.headlineMetrics.reason).toContain('did not answer in time');
    // The signal really is aborted, so a cooperative adapter can stop working.
    expect(aborted).toBe(true);
  });

  it('lets another source contribute while one times out', async () => {
    const hung = descriptor(
      'hung',
      ['headlineMetrics'],
      () => new Promise<never>(neverSettles),
      200,
    );
    const quick = descriptor('quick', ['attention'], () => ({
      status: 'OBSERVED',
      observedAt: new Date().toISOString(),
      sections: { attention: { items: [] } },
    }));

    const snapshot = await settle(loadControlPlaneSnapshot({ sources: [hung, quick] }));

    expect(snapshot.sections.headlineMetrics.availability).toBe('NOT_CONNECTED');
    expect(snapshot.sections.attention.availability).toBe('AVAILABLE');
    expect(snapshot.source.freshness).toBe('REQUEST_TIME');
  });

  it('clears its timer on the success path', async () => {
    const quick = descriptor('quick', ['headlineMetrics'], () => ({
      status: 'OBSERVED',
      observedAt: new Date().toISOString(),
      sections: { headlineMetrics: { items: [] } },
    }));
    await settle(loadControlPlaneSnapshot({ sources: [quick] }));
    // A leaked timer keeps the process awake and keeps a fake clock reporting finished work.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears its timer on the timeout path too', async () => {
    const hung = descriptor(
      'hung',
      ['headlineMetrics'],
      () => new Promise<never>(neverSettles),
      200,
    );
    await settle(loadControlPlaneSnapshot({ sources: [hung] }));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('creates NO timer for the empty registry', async () => {
    await loadControlPlaneSnapshot();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('survives a source that rejects LATE, after the bound elapsed', async () => {
    // The late rejection is already handled, so it cannot surface as an unhandled rejection -- and
    // nothing about it is read or rendered.
    const late = descriptor(
      'late',
      ['headlineMetrics'],
      () =>
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => {
            reject(new Error('too late at /srv/qf-jarvis/secrets'));
          }, 5_000);
        }),
      200,
    );
    const snapshot = await settle(loadControlPlaneSnapshot({ sources: [late] }));

    expect(snapshot.sections.headlineMetrics.availability).toBe('NOT_CONNECTED');
    expect(JSON.stringify(snapshot)).not.toContain('/srv/qf-jarvis/secrets');
  });
});
