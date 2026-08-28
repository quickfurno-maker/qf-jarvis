/**
 * JOS-01A — the invariants the dashboard must not lose (docs/architecture/jarvis-os.md).
 *
 * These are `.ts`, not `.tsx`, and they assert against the CATALOGS and the SOURCE rather
 * than against a rendered DOM. That is a deliberate trade and worth stating.
 *
 * A DOM-rendering suite would need jsdom, a React testing library and a second Vitest
 * environment — three dependencies and a config fork, to assert facts that live in data
 * modules anyway. The properties that actually matter here are: does the navigation contain
 * every module, are Aarohi and Anisha separate, is rollout stated, is the resume marker
 * present, and can any surface reach a backend. Every one of those is a fact about the
 * catalog or about what the source imports — and the source scan is strictly stronger than a
 * render test for the last one, because it fails on a `fetch(` that no test happens to
 * exercise.
 *
 * This mirrors how the rest of the repository proves containment.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  CAPABILITY_IDS,
  CAPABILITY_SNAPSHOT,
  CAPABILITY_LIFECYCLES,
  LIFECYCLE_PRESENTATION,
  capability,
  isInteractive,
} from './capabilities/catalog';
import type { CapabilityLifecycle } from './capabilities/catalog';
import { controlPlane } from './control-plane/index';
import { BASELINE_FACTS } from '../server/control-plane/repository-baseline';
import { HEALTH_PRESENTATION } from './control-plane/types';
import { NAV_GROUPS, NAV_ITEMS, activeHref } from './navigation/catalog';

const APP_DIR = new URL('../../', import.meta.url);
const SRC = fileURLToPath(new URL('src', APP_DIR));
/**
 * The specs are excluded from the source scans below.
 *
 * A containment spec must name the strings it forbids -- a URL, `supabase`, `fetch(` -- so
 * scanning one reports its own prohibition as the violation. This is the recurring false positive
 * in this repository's suites, and the fix is the same one `shadow-containment.test.ts` uses:
 * exclude exactly the scanners, so all production source stays covered.
 */
const SCANNERS: readonly string[] = Object.freeze([
  'src/lib/jarvis-os.test.ts',
  'src/server/control-plane/snapshot-api.test.ts',
  'src/server/auth/auth-crypto.test.ts',
  'src/server/auth/auth-http.test.ts',
  'src/server/auth/proxy-csp.test.ts',
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Every source file EXCEPT the scanners.
 *
 * These specs necessarily name every string they forbid. Scanning one would flag the
 * prohibition as the violation — the recurring false positive in this repository's suites.
 */
function sourceFiles(): string[] {
  return walk(SRC).filter(
    (file) => !SCANNERS.some((spec) => file.replace(/\\/g, '/').endsWith(`/${spec}`)),
  );
}

/** Strip documentation so a scan reads CODE. These modules describe what they refuse to do. */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

function allSource(): string {
  return sourceFiles()
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
}

describe('capability lifecycle', () => {
  it('renders every lifecycle with a text label, never colour alone', () => {
    for (const lifecycle of CAPABILITY_LIFECYCLES) {
      const presentation = LIFECYCLE_PRESENTATION[lifecycle];
      expect(presentation, lifecycle).toBeDefined();
      expect(presentation.label.length, lifecycle).toBeGreaterThan(0);
      expect(presentation.tone.length, lifecycle).toBeGreaterThan(0);
    }
  });

  it('gives every health state a text label too', () => {
    for (const [state, presentation] of Object.entries(HEALTH_PRESENTATION)) {
      expect(presentation.label.length, state).toBeGreaterThan(0);
    }
  });

  it('registers every catalogued capability id exactly once, each with a reason', () => {
    const ids = CAPABILITY_SNAPSHOT.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of CAPABILITY_IDS) {
      const entry = capability(id);
      expect(entry, id).toBeDefined();
      // A state without a reason is a state nobody can act on.
      expect(entry?.note.length ?? 0, id).toBeGreaterThan(20);
    }
  });

  it('treats ONLY "AVAILABLE" as interactive', () => {
    for (const lifecycle of CAPABILITY_LIFECYCLES) {
      expect(isInteractive(lifecycle), lifecycle).toBe(lifecycle === 'AVAILABLE');
    }
  });

  it('keeps every dangerous capability out of the interactive state', () => {
    // The specific regression this guards: someone flipping one of these to AVAILABLE to make
    // a surface look finished, and thereby rendering a live-looking control.
    const mustNotBeAvailable: readonly CapabilityLifecycle[] = ['AVAILABLE'];
    for (const id of [
      'approval.submit',
      'conversation.control.write',
      'communication.live-send',
      'execution.n8n.bridge',
      'aarohi.vendor-growth',
    ] as const) {
      const entry = capability(id);
      expect(entry, id).toBeDefined();
      expect(mustNotBeAvailable, id).not.toContain(entry?.lifecycle);
    }
  });

  it('states that production rollout is off', async () => {
    expect((await controlPlane()).systemHealth().rolloutEnabled).toBe(false);
    const rollout = (await controlPlane())
      .systemHealth()
      .components.find((component) => component.id === 'production-rollout');
    expect(rollout?.state).toBe('ROLLOUT_OFF');
    // And it is visible in the shell, not only in the model.
    expect(allSource()).toContain('Rollout off');
  });
});

describe('navigation', () => {
  it('contains every required module', () => {
    const hrefs = NAV_ITEMS.map((item) => item.href);
    for (const required of [
      '/',
      '/agents/jarvis',
      '/agents/riya',
      '/agents/aarohi',
      '/agents/anisha',
      '/operations',
      '/approvals',
      '/conversations',
      '/execution',
      '/knowledge',
      '/evaluations',
      '/models',
      '/workers',
      '/core-sync',
      '/integrations',
      '/analytics',
      '/governance',
      '/settings',
    ]) {
      expect(hrefs, required).toContain(required);
    }
  });

  it('has a page for every navigation entry', () => {
    for (const item of NAV_ITEMS) {
      // JOS-01C moved every operator page into the `(protected)` route group. Route groups are
      // organisational and never appear in a URL, so the hrefs are unchanged -- but the files moved.
      const relative =
        item.href === '/' ? 'app/(protected)/page.tsx' : `app/(protected)${item.href}/page.tsx`;
      expect(() => statSync(join(SRC, relative)), item.href).not.toThrow();
    }
  });

  it('resolves the most specific active entry, not the first prefix match', () => {
    expect(activeHref('/')).toBe('/');
    expect(activeHref('/agents/aarohi')).toBe('/agents/aarohi');
    expect(activeHref('/agents/anisha')).toBe('/agents/anisha');
    expect(activeHref('/approvals')).toBe('/approvals');
    // A deeper path still resolves to its own section rather than to the root.
    expect(activeHref('/execution/anything')).toBe('/execution');
  });

  it('declares no duplicate hrefs across groups', () => {
    const hrefs = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe('Aarohi and Anisha are separate agents', () => {
  it('are separate navigation entries with separate scopes', () => {
    const aarohi = NAV_ITEMS.find((item) => item.href === '/agents/aarohi');
    const anisha = NAV_ITEMS.find((item) => item.href === '/agents/anisha');
    expect(aarohi).toBeDefined();
    expect(anisha).toBeDefined();
    expect(aarohi?.href).not.toBe(anisha?.href);
    expect(aarohi?.scope).not.toBe(anisha?.scope);
    // The label names the owner-locked product surface.
    expect(aarohi?.label).toContain('Aarohi');
    expect(aarohi?.label).toContain('Vendor Growth');
  });

  it('hold separate capabilities, and Aarohi has no runtime', async () => {
    const plane = await controlPlane();
    const aarohi = plane.agent('aarohi');
    const anisha = plane.agent('anisha');
    expect(aarohi?.capabilityId).toBe('aarohi.vendor-growth');
    expect(anisha?.capabilityId).toBe('anisha.vendor-care');
    expect(aarohi?.capabilityId).not.toBe(anisha?.capabilityId);
    // Owner-locked: PLANNED / DISABLED, never live.
    expect(aarohi?.lifecycle).toBe('PLANNED');
    expect(aarohi?.state).toBe('PLANNED');
  });

  it('describe non-overlapping scopes: acquisition versus registered-vendor care', async () => {
    const plane = await controlPlane();
    const aarohi = plane.agent('aarohi');
    const anisha = plane.agent('anisha');
    expect(aarohi?.role.toLowerCase()).toContain('acquisition');
    expect(anisha?.role.toLowerCase()).toContain('registered');
    // Each states the boundary against the other in its own notes.
    expect(aarohi?.notes.join(' ')).toContain('Anisha');
    expect(anisha?.notes.join(' ')).toContain('Aarohi');
  });

  it('shows no outreach activity for Aarohi anywhere in the model', async () => {
    // JOS-01B: the funnel is PLANNED and carries no stages at all. A list of zeroed stages was
    // the JOS-01A answer; a PLANNED source with nothing in it is the honest one, because no
    // stage has ever been measured.
    const funnel = (await controlPlane()).vendorGrowthFunnel();
    expect(funnel.availability).toBe('PLANNED');
    expect(funnel.items).toHaveLength(0);
    // AVG-11 merged the certified funnel CONTRACT, not a reading of one. Any stage that did appear
    // would have to carry an authority, and none may carry a count it has not earned.
    for (const stage of funnel.items) {
      if (stage.authority === 'AUTHORITY_UNAVAILABLE') {
        expect(Object.hasOwn(stage, 'value'), stage.id).toBe(false);
      } else {
        expect(stage.value, stage.id).toBe(0);
      }
    }
    // Workload is unreadable, so it reports no Aarohi share rather than a zero share.
    const workload = (await controlPlane()).agentWorkload();
    expect(workload.availability).toBe('NOT_CONNECTED');
    expect(workload.items).toHaveLength(0);
  });
});

describe('the resume marker and phase truth', () => {
  it('records QFJ-P09.02 and QFJ-P09.03 as merged, and invents no successor', async () => {
    // The markers moved when PR #95 and PR #96 merged. What merged is a test-only dispatch
    // VALIDATION boundary and then DURABILITY for its replay guard -- so neither label may read as
    // an n8n bridge, and n8n must still report NOT_CONNECTED. Replacing "not implemented" with
    // "the bridge is live" would swap one falsehood for a worse one.
    const roadmap = (await controlPlane()).roadmap();
    const qfj = roadmap.filter((marker) => marker.track === 'QFJ');

    const p0902 = qfj.find((marker) => marker.label.includes('QFJ-P09.02'));
    expect(p0902?.state).toBe('merged');
    expect(p0902?.label).not.toContain('n8n bridge');
    expect(p0902?.detail).toContain('not implemented');

    const p0903 = qfj.find((marker) => marker.label.includes('QFJ-P09.03'));
    expect(p0903?.state).toBe('merged');
    expect(p0903?.label).toContain(BASELINE_FACTS.mergedPhase);
    expect(p0903?.detail).not.toContain('not merged');
    expect(p0903?.detail).toContain('connects nothing');

    // The QFJ track now has NO slice in flight, and that is the truth rather than a gap to fill.
    // A `current` marker here could only be a QFJ-P09.04 nobody has locked.
    expect(qfj.filter((marker) => marker.state === 'current')).toHaveLength(0);
    expect(qfj.filter((marker) => marker.state === 'next')).toHaveLength(0);
    expect(BASELINE_FACTS.qfjTrackHasNoLockedSuccessor).toBe(true);
    expect(JSON.stringify(roadmap)).not.toContain('QFJ-P09.04');
  });

  it('keeps the JOS current marker in step with BASELINE_FACTS', async () => {
    // The invariant that would have caught a real inconsistency: JOS-01C advanced
    // `BASELINE_FACTS.josPhase` but left the rendered markers claiming JOS-01B was current, and
    // nothing compared the two. Asserting a SPECIFIC phase here would need editing every phase --
    // and a test that is always edited stops being a check. Asserting they AGREE does not.
    const jos = (await controlPlane()).roadmap().filter((marker) => marker.track === 'JOS');

    const current = jos.filter((marker) => marker.state === 'current');
    expect(current, 'exactly one JOS slice is current').toHaveLength(1);
    expect(current[0]?.label).toContain(BASELINE_FACTS.josPhase);

    // JOS-01E is the LAST slice of the bounded foundation track, so the track has no `next`.
    // Requiring one would only be satisfiable by inventing a successor phase.
    const next = jos.filter((marker) => marker.state === 'next');
    expect(next, 'the JOS foundation track closes after its current slice').toHaveLength(0);
    expect(BASELINE_FACTS.josTrackClosesAfter).toBe(BASELINE_FACTS.josPhase);

    // Everything before the current slice is merged, and nothing after it is.
    expect(jos.filter((marker) => marker.state === 'merged').length).toBeGreaterThan(0);
    expect(jos.filter((marker) => marker.state === 'planned')).toHaveLength(0);
  });

  it('carries exactly one in-flight marker in the whole roadmap, and it is the JOS one', async () => {
    // The tracks stay separate and are not symmetrical. The JOS foundation track closes at its
    // current slice; the QFJ execution track has merged everything owner-locked so far and has no
    // successor. So the ONLY in-flight marker anywhere belongs to JOS, and there is no `next`
    // marker at all -- inventing either would mean naming a phase nobody has locked.
    const roadmap = (await controlPlane()).roadmap();
    expect(roadmap.filter((marker) => marker.state === 'next')).toHaveLength(0);

    const current = roadmap.filter((marker) => marker.state === 'current');
    expect(current).toHaveLength(1);
    expect(current[0]?.track).toBe('JOS');
    expect(current[0]?.label).toContain(BASELINE_FACTS.josPhase);
  });

  it('records QFJ-P09.01 as merged', async () => {
    const merged = (await controlPlane())
      .roadmap()
      .filter((marker) => marker.state === 'merged')
      .map((marker) => marker.label)
      .join(' ');
    expect(merged).toContain('QFJ-P09.01');
  });

  it('renders the resume marker on the Execution and Governance surfaces', () => {
    for (const relative of [
      'app/(protected)/execution/page.tsx',
      'app/(protected)/governance/page.tsx',
    ]) {
      const source = readFileSync(join(SRC, relative), 'utf8');
      expect(source, relative).toContain('QFJ-P09.02');
    }
  });
});

describe('the default read model is the repository baseline, and read-only', () => {
  it('never promotes a compiled-in baseline to request-time freshness', async () => {
    // `generatedAt` says when this snapshot was produced. `source.freshness` says how old the
    // FACTS are. Serving more often may move the first; it can never move the second.
    const provenance = (await controlPlane()).provenance();
    expect(provenance.freshness).toBe('BUILD_DECLARATION');
    expect(provenance.liveOperationalData).toBe(false);
    expect(provenance.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('is NOT the demo fixture', async () => {
    // The whole point of JOS-01B. JOS-01A shipped `kind: 'demo'` as the default operator surface;
    // a synthetic queue of waiting approvals teaches an operator to believe numbers that describe
    // nothing. The fixture still exists for tests and visual fixtures, and is no longer default.
    const plane = await controlPlane();
    expect(plane.kind).toBe('baseline');
    expect(plane.provenance().kind).toBe('REPOSITORY_BASELINE');
    expect(plane.provenance().liveOperationalData).toBe(false);
  });

  it('declares no writer', async () => {
    const plane = await controlPlane();
    expect(Object.isFrozen(plane)).toBe(true);
    const surface = plane as unknown as Record<string, unknown>;
    for (const forbidden of [
      'approve',
      'reject',
      'submit',
      'send',
      'dispatch',
      'execute',
      'mutate',
      'update',
      'write',
      'takeover',
      'pause',
      'resume',
    ]) {
      expect(surface[forbidden], forbidden).toBeUndefined();
    }
  });

  it('returns the same frozen data on repeated reads of one request’s model', async () => {
    // JOS-01E made this per-request rather than a process singleton, so the property asserted here
    // had to become the honest one. WITHIN one resolved read model, repeated reads are the same
    // frozen object — a caller still cannot mutate what another caller sees.
    const plane = await controlPlane();
    const a = plane.approvalQueue();
    const b = plane.approvalQueue();
    expect(a).toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
  });

  it('gives two requests deeply equal data while no source is adopted', async () => {
    // Reference identity across requests is exactly what must NOT be assumed once a source can be
    // adopted: a later request has to be free to observe something newer. With the registry empty
    // the content is still identical, which is the property that matters here.
    const first = (await controlPlane()).approvalQueue();
    const second = (await controlPlane()).approvalQueue();
    expect(second).toStrictEqual(first);
  });

  it('carries no business records and no contact details at all', async () => {
    const text = JSON.stringify({
      approvals: (await controlPlane()).approvalQueue(),
      conversations: (await controlPlane()).conversationControl(),
      attention: (await controlPlane()).attention(),
      activity: (await controlPlane()).activity(),
      workers: (await controlPlane()).workers(),
      analytics: (await controlPlane()).businessAnalytics(),
    });
    // JOS-01A asserted that every business identifier carried a -DEMO- segment. The baseline
    // carries no business identifier AT ALL, which is a stronger property: there is nothing to
    // label because nothing was invented.
    for (const id of ['CONV-DEMO-', 'VENDOR-DEMO-', 'CASE-DEMO-', 'APPR-DEMO-', 'WORKER-DEMO-']) {
      expect(text, id).not.toContain(id);
    }
    // No contact detail may appear: an email or an E.164 number is a privacy incident.
    expect(text).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    expect(text).not.toMatch(/\+\d{8,}/);
  });

  it('reports every unconnected source as NOT_CONNECTED, never as an empty result', async () => {
    const plane = await controlPlane();
    const unconnected = {
      approvalQueue: plane.approvalQueue(),
      conversationControl: plane.conversationControl(),
      agentWorkload: plane.agentWorkload(),
      approvalBreakdown: plane.approvalBreakdown(),
      models: plane.models(),
      knowledge: plane.knowledge(),
      evaluations: plane.evaluations(),
      businessAnalytics: plane.businessAnalytics(),
      n8nExecution: plane.n8nExecution(),
    };
    for (const [name, section] of Object.entries(unconnected)) {
      expect(section.availability, name).toBe('NOT_CONNECTED');
      // Unreadable is not empty: a NOT_CONNECTED section must carry no rows to be mistaken for.
      expect(section.items, name).toHaveLength(0);
      expect(section.reason.length, name).toBeGreaterThan(0);
      expect(section.expectedSource.length, name).toBeGreaterThan(0);
    }
    // Charts must not draw a flat zero line for a source nobody connected.
    for (const series of [plane.activitySeries(), plane.latencySeries()]) {
      expect(series.availability, series.id).toBe('NOT_CONNECTED');
      expect(series.points, series.id).toHaveLength(0);
    }
  });

  it('reports QuickFurno Core and n8n as NOT_CONNECTED', async () => {
    const byId = new Map(
      (await controlPlane())
        .systemHealth()
        .components.map((component) => [component.id, component]),
    );
    expect(byId.get('quickfurno-core')?.state).toBe('NOT_CONNECTED');
    expect(byId.get('n8n')?.state).toBe('NOT_CONNECTED');
  });
});

describe('no live action capability is exposed', () => {
  it('performs no network, storage or backend access anywhere in the app', () => {
    for (const file of sourceFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      const label = file.replace(/\\/g, '/').split('/apps/jarvis-os/')[1] ?? file;
      expect(code, `${label}: fetch`).not.toMatch(/\bfetch\s*\(/);
      expect(code, `${label}: XHR`).not.toMatch(/XMLHttpRequest|WebSocket|EventSource/);
      expect(code, `${label}: url`).not.toMatch(/https?:\/\//);
      // JOS-01C NARROWS this rather than removing it. `process.env` is permitted in exactly two
      // reviewed places -- the auth config-path boundary and the proxy's NODE_ENV check for
      // development-only CSP relaxations -- and stays forbidden everywhere else, which is where a
      // configuration read would actually be dangerous.
      const envAllowed = label === 'src/server/auth/config/loader.ts' || label === 'src/proxy.ts';
      if (!envAllowed) {
        expect(code, `${label}: env`).not.toMatch(/process\s*\.\s*env/);
      }
      expect(code, `${label}: storage`).not.toMatch(
        /localStorage|sessionStorage|indexedDB|document\.cookie/,
      );
      expect(code, `${label}: server action`).not.toMatch(/'use server'|"use server"/);
      expect(code, `${label}: node io`).not.toMatch(
        /from ['"]node:(net|http|https|dns|tls|child_process|dgram)['"]/,
      );
      // `node:fs` is permitted ONLY in the auth config loader. Everything else -- every page,
      // component and control-plane module -- still may not touch the filesystem.
      if (label !== 'src/server/auth/config/loader.ts') {
        expect(code, `${label}: fs`).not.toMatch(/from ['"]node:fs['"]/);
      }
    }
  });

  it('imports no database, provider, n8n or Meta client', () => {
    for (const file of sourceFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      const label = file.replace(/\\/g, '/').split('/apps/jarvis-os/')[1] ?? file;
      // Import SPECIFIERS, not raw substrings. `n8n-not-connected` is a legitimate identifier for
      // an attention row; `from 'n8n-workflow'` is the thing worth forbidding, and conflating the
      // two would force honest names to be renamed to satisfy a scanner.
      const specifiers = [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(
        (match) => match[1] ?? '',
      );
      for (const specifier of specifiers) {
        for (const forbidden of [
          'pg',
          'supabase',
          '@supabase',
          'n8n-',
          'whatsapp',
          'twilio',
          'groq',
          'openai',
        ]) {
          expect(
            specifier.toLowerCase().includes(forbidden.toLowerCase()),
            `${label}: imports ${specifier}`,
          ).toBe(false);
        }
      }
    }
  });

  it('imports exactly one workspace package, and it is the read contract', () => {
    // JOS-01B NARROWS this rule rather than relaxing it. Jarvis OS may import
    // `@qf-jarvis/control-plane-read-contract` -- a pure zod schema package with no Node API, no
    // network, no persistence and no authority -- and nothing else. Every backend package stays
    // forbidden: pulling one in would put persistence, transport or approval logic into a browser
    // bundle, which is the failure this rule has always existed to prevent.
    const ALLOWED = '@qf-jarvis/control-plane-read-contract';
    for (const file of sourceFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      const label = file.replace(/\\/g, '/').split('/apps/jarvis-os/')[1] ?? file;
      const specifiers = code.match(/@qf-jarvis\/[a-z0-9-]+/g) ?? [];
      for (const specifier of specifiers) {
        expect(specifier, `${label}: workspace import`).toBe(ALLOWED);
      }
    }
  });

  it('disables every control-looking action, with a stated reason', () => {
    const source = allSource();
    // Each action control in this release is disabled and labelled.
    for (const marker of [
      'Backend unavailable',
      'no control-plane API',
      'disabled, backend unavailable',
      'no control authority in Jarvis OS',
    ]) {
      expect(source, marker).toContain(marker);
    }
    // Every <button> in the application must carry `disabled`, EXCEPT an explicit allowlist.
    //
    // The allowlist is by FILE rather than by attribute pattern, deliberately. An attribute regex
    // over concatenated source is fragile -- a `>` inside an `onClick={() => ...}` truncates the
    // match -- and, worse, a pattern silently exempts any future button that happens to match it.
    // Naming the three files that may hold an enabled control means a fourth one fails this test.
    //
    // JOS-01C adds exactly two enabled controls: the login submit and the sign-out submit. Both
    // mutate browser authentication state alone (a cookie); neither approves, sends or executes
    // anything, and neither confers any QuickFurno business authority.
    const ENABLED_CONTROL_FILES: readonly string[] = Object.freeze([
      'src/components/shell/AppShell.tsx', // drawer open/close: navigation only
      'src/components/shell/OperatorMenu.tsx', // menu toggle + sign-out submit
      'src/components/auth/LoginForm.tsx', // sign-in submit
    ]);

    for (const file of sourceFiles()) {
      const label = file.replace(/\\/g, '/').split('/apps/jarvis-os/')[1] ?? file;
      if (ENABLED_CONTROL_FILES.includes(label)) {
        continue;
      }
      const code = readFileSync(file, 'utf8');
      const buttons = code.match(/<button[\s\S]*?>/g) ?? [];
      for (const button of buttons) {
        expect(button, `${label}: ${button.slice(0, 60)}`).toContain('disabled');
      }
    }
  });
});

/**
 * The Aarohi acquisition surface (AVG-11, ADR-0128).
 *
 * Two properties are being defended here, and they pull in opposite directions on purpose. The
 * surface must be COMPLETE — an operator should be able to see the whole acquisition domain,
 * including the bridges that were deliberately not built — and it must stay POWERLESS, with no
 * control, no live figure and no zero standing in for something nobody read.
 */
describe('the Aarohi acquisition surface stays a read surface', () => {
  const aarohiPage = () =>
    readFileSync(join(SRC, 'app', '(protected)', 'agents', 'aarohi', 'page.tsx'), 'utf8');

  it('reads readiness through the control-plane seam, with real provenance', async () => {
    const readiness = (await controlPlane()).aarohiReadiness();
    // STATIC_BASELINE, because every row is merged governance rather than an observation.
    expect(readiness.availability).toBe('STATIC_BASELINE');
    expect(readiness.items.length).toBeGreaterThan(0);
    expect(readiness.reason.length).toBeGreaterThan(0);
    expect(readiness.expectedSource.length).toBeGreaterThan(0);
    for (const row of readiness.items) {
      expect(row.detail.length, row.id).toBeGreaterThan(20);
      // Readiness says what EXISTS. A number here would be a metric wearing a status's clothes.
      expect(Object.keys(row).sort(), row.id).toStrictEqual([
        'detail',
        'id',
        'kind',
        'label',
        'state',
      ]);
    }
  });

  it('states the two bridges that were deliberately NOT built', async () => {
    const readiness = (await controlPlane()).aarohiReadiness();
    const blockers = readiness.items.filter((row) => row.kind === 'blocker');
    const ids = blockers.map((row) => row.id);
    // ADR-0127 refused both. A surface that simply omitted them would read as complete.
    expect(ids).toContain('blocker-post-registration-continuation');
    expect(ids).toContain('blocker-awaiting-core-activation-bridge');
    expect(ids).toContain('blocker-core-read-protocol');
    for (const blocker of blockers) {
      expect(blocker.state, blocker.id).not.toBe('AVAILABLE');
      expect(blocker.state, blocker.id).not.toBe('HEALTHY');
    }
  });

  it('never marks Aarohi AVAILABLE anywhere in the read model', async () => {
    const plane = await controlPlane();
    expect(plane.agent('aarohi')?.lifecycle).toBe('PLANNED');
    expect(plane.agent('aarohi')?.state).toBe('PLANNED');
    for (const row of plane.aarohiReadiness().items) {
      expect(row.state, row.id).not.toBe('AVAILABLE');
      expect(row.state, row.id).not.toBe('HEALTHY');
      expect(row.state, row.id).not.toBe('CONNECTED');
    }
  });

  it('exposes no action control on the Aarohi page', () => {
    const code = codeOnly(aarohiPage());
    // Named by the thing they would DO, not by a stray word: a page that could do any of these
    // would be a second business authority.
    for (const forbidden of [
      '<button',
      '<form',
      '<input',
      'onClick',
      'onSubmit',
      'useState',
      "'use client'",
      'Mark Registered',
      'Mark Paid',
      'Activate',
      'Grant Credits',
      'Assign Package',
      'Retry Payment',
      'Send WhatsApp',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('keeps the workflow-versus-business-outcome boundary visible on the page', () => {
    const text = aarohiPage();
    expect(text).toContain('not a registration');
    expect(text).toContain('not a payment');
    expect(text).toContain('not an activation');
    expect(text).toContain('Aarohi is not Anisha');
    expect(text).toContain('never zero');
  });
});

describe('the funnel contract cannot publish a business outcome', () => {
  it('offers no stage id naming a registration, payment, activation or conversion', () => {
    // The vocabulary is closed at the type level, so this scans the one place a stage is written
    // down in this app: the demo fixture. A `registered` stage would not compile, and would not
    // pass here either.
    const fixture = codeOnly(readFileSync(join(SRC, 'lib', 'demo-data', 'snapshot.ts'), 'utf8'));
    const funnel = fixture.slice(
      fixture.indexOf('VENDOR_GROWTH_FUNNEL'),
      fixture.indexOf('AAROHI_READINESS'),
    );
    for (const forbidden of [
      "id: 'registered'",
      "id: 'paid-active'",
      "id: 'active'",
      "id: 'converted'",
      "id: 'contacted'",
      "id: 'paid'",
    ]) {
      expect(funnel, forbidden).not.toContain(forbidden);
    }
  });

  it('renders an unavailable stage without a bar and without a number', () => {
    const charts = readFileSync(join(SRC, 'components', 'charts', 'Charts.tsx'), 'utf8');
    // The guard has to exist in the component, not only in the type: a chart that divided by `max`
    // for an unavailable stage would draw a zero-length bar, which reads as "none".
    expect(charts).toContain("stage.authority === 'AUTHORITY_UNAVAILABLE'");
    expect(charts).toContain('Unknown');
    // And the old conflation is gone: a genuine zero must print as a zero.
    expect(codeOnly(charts)).not.toContain("stage.value === 0 ? '—'");
  });

  it('never lets the UI mapper default a missing count to zero', () => {
    const mapper = codeOnly(
      readFileSync(join(SRC, 'server', 'control-plane', 'map-to-ui-model.ts'), 'utf8'),
    );
    expect(mapper).not.toContain('stage.value ?? 0');
    expect(mapper).not.toContain('value: 0');
  });
});
