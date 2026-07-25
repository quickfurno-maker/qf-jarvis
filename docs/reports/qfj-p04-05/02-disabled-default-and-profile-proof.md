# Report 02 — Disabled Default and Profile Proof

**Slice:** QFJ-P04.05 — No-Op RAG Provisioning. **ADR:** [ADR-0053](../../decisions/ADR-0053-qfj-p04-05-no-op-rag-provisioning.md).

## Modes — only two, RAG off

The closed modes are `DISABLED` and `PROVISIONED_NO_OP` (proven the vocabulary equals exactly these two). There is **no** `ENABLED`/`ACTIVE` mode and **no** `enabled=true` field — a config carrying `enabled: true` is rejected by the strict schema (proven). No transition turns RAG on.

## Default and fail-closed

Proven:

- **Absent config → `DISABLED`.** `createRagProvisioner()` yields a `disabled` provisioner; invoking it returns `rag-disabled` with zero counters.
- **Malformed config → fail closed (no throw).** `createRagProvisioner({ garbage: true })` yields an `invalid` provisioner; invoking it returns `rag-profile-invalid`. There is no hidden/auto/environment enablement.

## Exact profile identity

A valid `DISABLED`/`PROVISIONED_NO_OP` profile is deep-frozen (proven). It binds exact profile id/version, mode, backend kind, and (optional, future-facing) governed-knowledge revision / capability ref / evaluation evidence ref, plus policy revision, config digest, and a canonical instant. Rejected (proven): a non-canonical instant; a non-positive version; an invalid/oversized identifier; a **wildcard/`latest`** id; an unknown mode or backend kind; and any **endpoint/secret/`apiKey`/arbitrary** field (the schema is strict). When present, the capability/evaluation/knowledge/policy references are preserved exactly.

## Missing future-facing references fail closed

For a `PROVISIONED_NO_OP` profile, an omitted reference yields the precise reason (proven): `rag-evaluation-reference-missing`, `rag-capability-reference-missing`, or `rag-knowledge-revision-missing` — always a content-free no-op, never a retrieval.
