/**
 * QF Jarvis — API application boundary.
 *
 * Phase 1 (Engineering Foundation) establishes a *compileable boundary* and
 * nothing else. This module therefore contains no runtime behavior by design:
 * no HTTP server, no framework, no routes, no health check, no handlers, no
 * startup logging, and no imports.
 *
 * The boundary exists now, empty, so that the module structure of the modular
 * monolith is real from the first commit rather than retrofitted onto working
 * code later (ADR-0004, ADR-0010). An empty boundary that compiles is a
 * structure; a placeholder implementation is a liability, because it is
 * indistinguishable from an intention and it will be built upon.
 *
 * What lands here, and when, is decided by the phased roadmap — not by whoever
 * needs somewhere to put something. See docs/architecture/phased-roadmap.md.
 *
 * The permanent architecture boundary applies to every line ever added to this
 * application: Jarvis recommends, QuickFurno Core authorizes, n8n executes,
 * providers deliver, and results return to Core. See
 * docs/architecture/system-boundary.md — it is authoritative.
 */

export {};
