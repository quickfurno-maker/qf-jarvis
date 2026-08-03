/**
 * QFJ-P12 — canonical governance consistency (ADR-0085).
 *
 * These assertions exist because of a specific, real failure. PR #88 (the Jarvis OS control plane)
 * arrived describing Aarohi and Anisha as separate agents and QFJ-P09.01 as merged, while the
 * canonical documents still defined three agents and still called P09.01 an unmerged feature branch.
 * Both statements were individually plausible and neither was flagged by any gate, because nothing
 * compared the documents to each other.
 *
 * A contradiction between two documents is exactly the class of defect that review misses and a cheap
 * test catches: it lives in the space *between* files, where no single reviewer is looking.
 *
 * Scope is deliberately narrow. This is not a prose linter and it does not police wording. It checks
 * a handful of load-bearing facts that must agree across the canonical set:
 *
 *   1. QFJ-P09.01 is recorded as MERGED, and cannot simultaneously be recorded as unmerged.
 *   2. The governed roster is four agents, and the Aarohi/Anisha boundary reads the same everywhere.
 *   3. The AVG overlay stays an overlay -- no QFJ-P13 phase is ever defined.
 *   4. Aarohi's runtime stays PLANNED/DISABLED.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

const read = (relative: string): string =>
  readFileSync(new URL(relative, new URL(`file://${REPO_ROOT.replace(/\\/g, '/')}`)), 'utf8');

const ROADMAP = 'docs/architecture/qf-jarvis-roadmap-v3.md';
const CONSTITUTION = 'docs/governance/agent-constitution.md';
const MATRIX = 'docs/governance/authority-routing-data-access-matrix.md';
const OVERLAY = 'docs/architecture/aarohi-vendor-growth-roadmap-overlay.md';
const ADR = 'docs/decisions/ADR-0085-qfj-p12-aarohi-vendor-growth-and-roadmap-reconciliation.md';
const JARVIS_OS = 'docs/architecture/jarvis-os.md';

const CANONICAL: readonly string[] = Object.freeze([ROADMAP, CONSTITUTION, MATRIX, OVERLAY, ADR]);

/**
 * Collapse a document for PROSE matching.
 *
 * These files are hard-wrapped Markdown, so one sentence routinely spans a newline and carries `**`
 * emphasis in the middle of it. Matching raw text would turn every prose assertion below into a test
 * of where the line happened to wrap, which is not a fact worth locking.
 */
const flat = (text: string): string => text.replace(/[*`]/gu, '').replace(/\s+/gu, ' ');

/**
 * Split into sentences before looking for a contradiction.
 *
 * Whole-document matching would be useless here: a roadmap legitimately contains "merged" and "not
 * merged" hundreds of lines apart about entirely different slices. The contradiction only means
 * something when both claims are made about the same subject in the same breath.
 */
const sentences = (text: string): readonly string[] =>
  text
    .split(/(?<=[.!?])\s+|\n{2,}|\n(?=[-*|#])/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

describe('QFJ-P12 (ADR-0085) canonical governance consistency', () => {
  describe('QFJ-P09.01 status is recorded once, and consistently', () => {
    it('records QFJ-P09.01 as MERGED with its exact merge commit', () => {
      const roadmap = read(ROADMAP);
      expect(roadmap).toContain('QFJ-P09.01 — execution intent correlation — is MERGED');
      expect(roadmap).toContain('710426bc8546441e1c1d2d284a91ee127aa60414');
      expect(roadmap).toContain('e0bc58c33adcf09cc98fcbeddef14682a7e0a7ce');
    });

    it('never claims in one breath that QFJ-P09.01 is both merged and an unmerged branch', () => {
      // ADR-0085 is excluded by design: its Context QUOTES the stale wording ("implemented on a
      // feature branch, not merged") to record exactly what it was correcting. A document that names
      // the defect it repairs would otherwise be reported as the defect -- the same reason
      // shadow-containment.test.ts excludes its own scanners.
      const scanned = CANONICAL.filter((file) => file !== ADR);
      for (const file of scanned) {
        const offending = sentences(read(file)).filter((sentence) => {
          if (!sentence.includes('QFJ-P09.01')) {
            return false;
          }
          // The exact stale shape this test exists to prevent, in either order.
          const claimsUnmerged =
            /not merged/iu.test(sentence) ||
            /implemented on a feature branch/iu.test(sentence) ||
            /is not yet merged/iu.test(sentence);
          return claimsUnmerged;
        });
        expect({ file, offending }).toEqual({ file, offending: [] });
      }
    });

    it('names QFJ-P09.02 as the next bounded slice, with live send off', () => {
      const roadmap = read(ROADMAP);
      expect(roadmap).toContain('QFJ-P09.02');
      expect(roadmap).toMatch(/NEXT bounded slice is QFJ-P09\.02/u);
      expect(roadmap).toMatch(/Live send remains OFF/u);
      // P09 as a whole is still open; a merged slice must never read as a completed phase.
      expect(roadmap).toMatch(/QFJ-P09 remains INCOMPLETE/u);
    });
  });

  describe('the governed roster is four agents', () => {
    it('the constitution defines Jarvis, Riya, Aarohi and Anisha', () => {
      const constitution = read(CONSTITUTION);
      expect(constitution).toContain('the four governed agents');
      expect(constitution).toContain('# Aarohi — Vendor Growth and Acquisition Agent');
      expect(constitution).toContain('# Anisha — Registered-Vendor Relationship and Success Agent');
      expect(constitution).toContain('# Riya — Customer Conversation and Qualification Agent');
      expect(constitution).toContain('# Jarvis — Coordination and Complex-Case Agent');
      // The roster line must not still say three.
      expect(constitution).not.toContain('the three governed agents');
    });

    it('reserves a fourth RAG namespace and never cross-reads', () => {
      expect(read(CONSTITUTION)).toContain('`JARVIS`, `RIYA`, `AAROHI`, `ANISHA`');
      expect(read(MATRIX)).toContain('`AAROHI` only');
      expect(read(ROADMAP)).toContain('`JARVIS`/`RIYA`/`AAROHI`/`ANISHA`');
    });

    it('the authority matrix carries an Aarohi column and Core-truth routing', () => {
      const matrix = read(MATRIX);
      expect(matrix).toContain('| Action | Riya | Aarohi (PLANNED) | Anisha | Jarvis |');
      expect(matrix).toMatch(/net-new UNREGISTERED vendor acquisition[^\n]*→ Aarohi/u);
      expect(matrix).toMatch(/REGISTERED\/existing vendor relationship[^\n]*→ Anisha/u);
    });
  });

  describe('the Aarohi/Anisha boundary reads the same everywhere', () => {
    it('every canonical document that names both draws the boundary at registration', () => {
      for (const file of [CONSTITUTION, MATRIX, ROADMAP, OVERLAY, ADR]) {
        const text = read(file);
        expect({ file, hasAarohi: text.includes('Aarohi') }).toEqual({ file, hasAarohi: true });
        expect({ file, hasAnisha: text.includes('Anisha') }).toEqual({ file, hasAnisha: true });
      }
      // The two rules that make the split enforceable rather than descriptive.
      for (const file of [CONSTITUTION, ROADMAP, OVERLAY, ADR]) {
        const text = read(file);
        expect({ file, active: text.includes('ACTIVE') }).toEqual({ file, active: true });
        expect({
          file,
          gate: flat(text).includes(
            'registered, active, inactive, dormant, former, previously contacted, duplicate',
          ),
        }).toEqual({ file, gate: true });
      }
    });

    it('Anisha is never described as owning acquisition of unregistered parties', () => {
      const constitution = read(CONSTITUTION);
      // The pre-ADR-0085 wording, which gave Anisha first-time prospects and the full lifecycle.
      expect(constitution).not.toContain('first-time prospects and existing, active, expired');
      expect(constitution).not.toContain('Anisha — Vendor Sales, Relationship and Success Agent');
    });

    it('the retired alias is recorded as retired and never used as an identifier', () => {
      const overlay = read(OVERLAY);
      expect(overlay).toContain('ANI-COLD-AQUI');
      expect(overlay).toMatch(/non-canonical/u);
      expect(overlay).toMatch(/retired/u);
    });
  });

  describe('canonical status lines do not invalidate themselves (JOS-01B, ADR-0086)', () => {
    it('never describes a JOS slice by its branch or merge state', () => {
      // The defect: "JOS-01B is implemented on a feature branch, not merged" is false the instant
      // that branch merges, and nobody goes back to fix it. GitHub owns merge state and tracks it
      // accurately; these documents describe architecture and build state, which stays true either
      // side of a pull request.
      for (const file of [JARVIS_OS, ROADMAP]) {
        const offending = sentences(read(file)).filter((sentence) => {
          if (!/JOS-01[A-E]/u.test(sentence)) {
            return false;
          }
          return (
            /implemented on a feature branch/iu.test(sentence) ||
            /is not merged/iu.test(sentence) ||
            /, not merged/iu.test(sentence)
          );
        });
        expect({ file, offending }).toEqual({ file, offending: [] });
      }
    });

    it('records JOS-01B as the current slice and JOS-01C as next', () => {
      const jarvisOs = flat(read(JARVIS_OS));
      expect(jarvisOs).toMatch(/JOS-01B is the current implemented Jarvis OS slice/u);
      expect(jarvisOs).toMatch(/JOS-01C[^.]*is next/u);
      expect(jarvisOs).toContain('Nothing is deployed');
    });

    it('keeps QFJ-P09.02 as the main-track resume point alongside the JOS track', () => {
      const roadmap = flat(read(ROADMAP));
      expect(roadmap).toMatch(/NEXT bounded slice is QFJ-P09.02/u);
      expect(roadmap).toMatch(/generatedAt records when the JSON was produced/u);
    });
  });

  describe('the AVG overlay stays an overlay', () => {
    it('records AVG-0 through AVG-12', () => {
      const overlay = read(OVERLAY);
      for (let stage = 0; stage <= 12; stage += 1) {
        expect({ stage, present: overlay.includes(`### AVG-${String(stage)} —`) }).toEqual({
          stage,
          present: true,
        });
      }
    });

    it('defines no QFJ-P13 phase anywhere in the canonical set', () => {
      for (const file of CANONICAL) {
        const headings = read(file)
          .split(/\r?\n/u)
          .filter((line) => /^#{1,6}\s*QFJ-P13/u.test(line.trim()));
        expect({ file, headings }).toEqual({ file, headings: [] });
      }
      // And the spine still ends at P12.
      expect(read(ROADMAP)).toContain('## QFJ-P12 — Advanced Intelligence and Future Agents');
    });

    it('keeps Aarohi PLANNED/DISABLED with no channel or runtime', () => {
      const overlay = read(OVERLAY);
      expect(flat(overlay)).toMatch(/Runtime status: PLANNED \/ DISABLED/u);
      expect(flat(overlay)).toMatch(/no Aarohi runtime/u);
      expect(flat(read(ROADMAP))).toMatch(/Aarohi's runtime status is PLANNED \/ DISABLED/u);
    });

    it('keeps QuickFurno Core the commercial and activation authority', () => {
      const overlay = flat(read(OVERLAY));
      expect(overlay).toMatch(/Commercial truth .* comes from Core/u);
      expect(overlay).toMatch(/never from a model, never from RAG/u);
      expect(flat(read(MATRIX))).toContain('PROHIBITED from model/RAG/enrichment');
    });
  });
});
