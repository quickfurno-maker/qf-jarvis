/**
 * QF Jarvis — API application boundary.
 *
 * Phase 1 (Engineering Foundation) establishes a *compileable boundary* and
 * nothing else. This module therefore contains no runtime behavior by design:
 * no framework, no health check, no startup logging, and no imports.
 *
 * The application now contains internal modules that DO speak HTTP — the private
 * Riya web ingress adapter under `src/private-riya-web-ingress/` (ADR-0097). The
 * boundary this file describes is unchanged, and the distinction matters: that
 * adapter exports a `RequestListener` FACTORY. It calls no `listen`, creates no
 * server, reads no environment, and knows no port or host. Importing this package
 * root — or the ingress module itself — starts nothing, opens no socket, binds no
 * listener, and exposes no public route. Whether the ingress is ever bound, and to
 * which private interface, is a later deployment decision somebody makes, not a
 * side effect of an import.
 *
 * This module still exports no runtime capability at all.
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
