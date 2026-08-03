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

  it('states that production rollout is off', () => {
    expect(controlPlane().systemHealth().rolloutEnabled).toBe(false);
    const rollout = controlPlane()
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
      const relative = item.href === '/' ? 'app/page.tsx' : `app${item.href}/page.tsx`;
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

  it('hold separate capabilities, and Aarohi has no runtime', () => {
    const plane = controlPlane();
    const aarohi = plane.agent('aarohi');
    const anisha = plane.agent('anisha');
    expect(aarohi?.capabilityId).toBe('aarohi.vendor-growth');
    expect(anisha?.capabilityId).toBe('anisha.vendor-care');
    expect(aarohi?.capabilityId).not.toBe(anisha?.capabilityId);
    // Owner-locked: PLANNED / DISABLED, never live.
    expect(aarohi?.lifecycle).toBe('PLANNED');
    expect(aarohi?.state).toBe('PLANNED');
  });

  it('describe non-overlapping scopes: acquisition versus registered-vendor care', () => {
    const plane = controlPlane();
    const aarohi = plane.agent('aarohi');
    const anisha = plane.agent('anisha');
    expect(aarohi?.role.toLowerCase()).toContain('acquisition');
    expect(anisha?.role.toLowerCase()).toContain('registered');
    // Each states the boundary against the other in its own notes.
    expect(aarohi?.notes.join(' ')).toContain('Anisha');
    expect(anisha?.notes.join(' ')).toContain('Aarohi');
  });

  it('shows no outreach activity for Aarohi anywhere in the model', () => {
    // JOS-01B: the funnel is PLANNED and carries no stages at all. A list of zeroed stages was
    // the JOS-01A answer; a PLANNED source with nothing in it is the honest one, because no
    // stage has ever been measured.
    const funnel = controlPlane().vendorGrowthFunnel();
    expect(funnel.availability).toBe('PLANNED');
    expect(funnel.items).toHaveLength(0);
    for (const stage of funnel.items) {
      expect(stage.value, stage.id).toBe(0);
    }
    // Workload is unreadable, so it reports no Aarohi share rather than a zero share.
    const workload = controlPlane().agentWorkload();
    expect(workload.availability).toBe('NOT_CONNECTED');
    expect(workload.items).toHaveLength(0);
  });
});

describe('the resume marker and phase truth', () => {
  it('names QFJ-P09.02 as the next main-track slice', () => {
    // The roadmap carries both main-track (QFJ-) and Jarvis OS (JOS-) markers, so 'next' is
    // scoped to the main track: there must be exactly one main-track resume point, and it is
    // QFJ-P09.02. A second one would mean the roadmap had stopped saying where work resumes.
    const next = controlPlane()
      .roadmap()
      .filter((marker) => marker.state === 'next' && marker.label.startsWith('QFJ-'));
    expect(next).toHaveLength(1);
    expect(next[0]?.label).toContain('QFJ-P09.02');
  });

  it('records QFJ-P09.01 as merged', () => {
    const merged = controlPlane()
      .roadmap()
      .filter((marker) => marker.state === 'merged')
      .map((marker) => marker.label)
      .join(' ');
    expect(merged).toContain('QFJ-P09.01');
  });

  it('renders the resume marker on the Execution and Governance surfaces', () => {
    for (const relative of ['app/execution/page.tsx', 'app/governance/page.tsx']) {
      const source = readFileSync(join(SRC, relative), 'utf8');
      expect(source, relative).toContain('QFJ-P09.02');
    }
  });
});

describe('the default read model is the repository baseline, and read-only', () => {
  it('is NOT the demo fixture', () => {
    // The whole point of JOS-01B. JOS-01A shipped `kind: 'demo'` as the default operator surface;
    // a synthetic queue of waiting approvals teaches an operator to believe numbers that describe
    // nothing. The fixture still exists for tests and visual fixtures, and is no longer default.
    const plane = controlPlane();
    expect(plane.kind).toBe('baseline');
    expect(plane.provenance().kind).toBe('REPOSITORY_BASELINE');
    expect(plane.provenance().liveOperationalData).toBe(false);
  });

  it('declares no writer', () => {
    const plane = controlPlane();
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

  it('returns the same frozen data on repeated reads', () => {
    const a = controlPlane().approvalQueue();
    const b = controlPlane().approvalQueue();
    expect(a).toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
  });

  it('carries no business records and no contact details at all', () => {
    const text = JSON.stringify({
      approvals: controlPlane().approvalQueue(),
      conversations: controlPlane().conversationControl(),
      attention: controlPlane().attention(),
      activity: controlPlane().activity(),
      workers: controlPlane().workers(),
      analytics: controlPlane().businessAnalytics(),
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

  it('reports every unconnected source as NOT_CONNECTED, never as an empty result', () => {
    const plane = controlPlane();
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

  it('reports QuickFurno Core and n8n as NOT_CONNECTED', () => {
    const byId = new Map(
      controlPlane()
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
      expect(code, `${label}: env`).not.toMatch(/process\s*\.\s*env/);
      expect(code, `${label}: storage`).not.toMatch(
        /localStorage|sessionStorage|indexedDB|document\.cookie/,
      );
      expect(code, `${label}: server action`).not.toMatch(/'use server'|"use server"/);
      expect(code, `${label}: node io`).not.toMatch(
        /from ['"]node:(net|http|https|dns|tls|child_process|dgram)['"]/,
      );
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
    // Every <button> that is not a pure navigation control carries `disabled`.
    //
    // The drawer's open and close buttons are exempt: they move the operator around this
    // surface and reach nothing. Every OTHER button in the application is an action-looking
    // control, and each must be disabled with a reason.
    const buttons = source.match(/<button[\s\S]{0,320}?>/g) ?? [];
    const actionable = buttons.filter(
      (button) => !/aria-label="(Open|Close) navigation"/.test(button),
    );
    for (const button of actionable) {
      expect(button, button.slice(0, 80)).toContain('disabled');
    }
  });
});
