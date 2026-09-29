# ADR-0175 — OpenAI Luna/Sol certification lineage

**Status:** Accepted / certification scaffold only
**Date:** 2026-09-29
**Depends on:** ADR-0172, ADR-0173, ADR-0174

## Decision

OpenAI activation uses a new certification lineage rather than editing or reinterpreting the existing
Groq JF-5B/JF-5C evidence. Historical Groq/Nara receipts and the current Groq production seal remain
immutable.

The certification candidates are the exact OpenAI API catalogue identifiers observed on 2026-09-29:

- Luna: `gpt-6-luna`
- Sol: `gpt-6-sol`

The fresher OpenAI API pricing catalogue (observed 2026-09-29) lists GPT-6 Luna/Sol as current latest models. An older models page still listed GPT-5.6, so certification intentionally follows the fresher catalogue observation rather than a stale documentation snapshot.

The provider posture is `OPENAI_ONLY`. No floating `latest`, wildcard, AUTO fallback or silent
cross-provider substitution is permitted.

## Execution identity

The candidate release digest binds all of the following:

- canonical provider id `openai`;
- exact catalogue model id;
- catalogue observation label `catalogue-observed-2026-09-29`;
- Responses API only;
- `store: false`;
- strict JSON Schema output;
- streaming disabled;
- tools disabled;
- web search disabled;
- the existing bounded Jarvis input/output token ceilings; and
- the reviewed OpenAI data-controls reference.

The catalogue observation label is not represented as a weight hash. The public API model id is the
provider identity available to us; the observation date and configuration digest state exactly what
Jarvis certified without inventing an unpublished immutable weight identifier.

## Evaluation matrix

Both models must independently pass all three production prompt bindings:

- Riya / CLIENT
- Anisha / VENDOR
- Aarohi / PROSPECT

That produces six exact model × prompt bindings. Each carries the reviewed prompt-content digest and,
when production RAG is enabled, the exact immutable knowledge revision.

The intended adaptive route after certification is:

- SIMPLE → Luna
- STANDARD → Luna
- COMPLEX → Sol

This is routing intent only. It grants no release ACTIVE status.

## Activation gate

This ADR and its profile do **not** activate OpenAI.

Activation still requires a governed project service-account credential, live provider execution,
sanitized evaluation receipts, red-team evidence, all three agent approvals, owner acceptance, the
matching data-control attestation, and a new exact production seal covering the OpenAI release(s),
prompt digests, configuration digest and optional knowledge revision.

Until those artifacts exist, production remains on the currently sealed provider release. The adaptive
runtime may not name Luna or Sol in its active-release set merely because this profile exists.

QuickFurno remains final business, communication and execution authority. OpenAI receives no web,
tool, MCP, database or direct action authority.
