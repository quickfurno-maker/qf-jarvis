# ADR-0176 — Initial QuickFurno production knowledge corpus v1

**Status:** Accepted for implementation; production activation still requires owner approval, exact-revision certification and controlled rollout  
**Date:** 2026-10-01  
**Relates to:** ADR-0158, ADR-0159, ADR-0164, ADR-0173

## Decision

The first production knowledge release for Riya, Anisha and Aarohi is a deliberately small, curated
QuickFurno business corpus sourced from the exact QuickFurno repository revision:

`c567b58a2c380b53d98a246a1b87b13f92e4aeda`

It contains seven stable business-reference topics only:

- `quickfurno-overview`
- `matching-process`
- `vendor-listing-policy`
- `lead-sharing-privacy`
- `service-categories`
- `pune-service-areas`
- `vendor-join-overview`

The source text is taken from the current QuickFurno Terms, Privacy, homepage/FAQ and canonical
category files. Repository presence alone is not approval: the runtime manifest is emitted only after
an explicit approval identity, approval instant and approval reference are supplied at the operator
boundary.

## Explicit exclusions

The knowledge release does **not** contain live or volatile QuickFurno truth such as:

- current prices or package values;
- credits, payment or wallet state;
- lead, vendor or assignment state;
- current vendor availability or capacity;
- live matching results;
- guarantees of lead volume;
- any client/vendor subject-linked record.

Those facts remain QuickFurno Core/live-tool authority as required by ADR-0173.

## Governance

Every source document is:

- `HOSTED_ALLOWED`;
- subject-free;
- attributable to the pinned QuickFurno source revision;
- scoped to explicit agent/purpose permissions;
- ACTIVE only after owner approval metadata is supplied;
- bounded by a 90-day expiry so stale approved website/business reference content fails closed.

The PostgreSQL release revision is derived from content + governance + approval metadata as
`qfkb.sha256.<digest>`. A content, source, permission, approval or freshness change therefore creates
a different release identity.

## Activation sequence

1. Owner reviews the curated corpus and provides approval metadata.
2. Build a PostgreSQL release with `qfj-knowledge-build-candidate`.
3. The builder stages and seals the release but **never activates it**.
4. Run repository tests, retrieval/evaluation checks and exact-revision JF-5B/JF-5C certification.
5. Activate only the exact sealed revision with `qfj-knowledge-activate`.
6. Deploy the worker in `HYBRID` mode bound to the exact revision and embedding model.
7. Canary Riya, Anisha and Aarohi and verify citations/RAG observations before broader use.

The activation command derives the expected release revision from the same owner-approved manifest;
it does not accept an arbitrary revision argument.

## Authority boundary

Knowledge may ground a model reply but never authorizes a business or communication effect.
QuickFurno Core remains the business and send authority. Jarvis remains the governed intelligence and
orchestration layer.
