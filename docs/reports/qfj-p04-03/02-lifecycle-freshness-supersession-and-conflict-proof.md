# Report 02 — Lifecycle, Freshness, Supersession, and Conflict Proof

**Slice:** QFJ-P04.03 — Governed Knowledge System. **ADR:** [ADR-0051](../../decisions/ADR-0051-qfj-p04-03-governed-knowledge-system.md).

## Lifecycle

The closed lifecycle `UPLOADED → SCANNED → REVIEWED → APPROVED → ACTIVE → RETIRED` is immutable and deterministic. `isValidLifecycleTransition` permits only the single forward step at each stage; every skip, backward move, or self-transition is rejected (proven). Retrieval serves **ACTIVE only**; a RETIRED record is never served as current knowledge (proven — it returns `knowledge-not-active`).

## Record identity and validation

`createKnowledgeRecord` validates and deep-freezes. Proven rejections: a non-canonical instant; a non-positive or non-integer version; an invalid or oversized identifier; a wildcard/`latest` authoritative identity; an unknown enum for source type / authority tier / data class / lifecycle / content format; an arbitrary/unknown metadata key (no secret smuggling); an ACTIVE/APPROVED/RETIRED record **without** approval metadata; a volatile source type (`PACKAGE_REFERENCE`/`PRODUCT_REFERENCE`/`WEBSITE_CONTENT`) **without** an expiry; and an incoherent effective/expiry/approval ordering. A valid record is frozen (proven).

## Registry invariants

The registry is built once and is immutable. Proven: deterministic ordering by `(knowledgeId, version)`; a duplicate id/version is rejected (`duplicate-record`); the same id/version with a **different** content digest is rejected (`conflicting-record`); exact id/version and exact topic lookup both work; and the snapshot is frozen and **content-free** (no `content`, no subject reference — proven by serialisation).

## Freshness and supersession

As-of retrieval excludes records that are **not yet effective** (`knowledge-not-effective`), **expired** (`knowledge-expired`, including stale volatile package/product/website facts), or **superseded** (`knowledge-superseded`). Supersession is validated at registry build in three ordered steps — a `supersededBy` that resolves to **no** record fails (`supersession-missing`); a **cycle** fails (`supersession-cycle`); a target that is **not strictly newer** fails (`supersession-not-newer`) — each proven independently, and a valid older→newer chain is accepted.

## Conflict resolution (fail closed)

For a topic, retrieval filters to the eligible records, then selects the **single highest permitted authority tier**. Proven: the highest tier wins and a lower tier never overrides it; two eligible records at the **same** tier fail closed (`knowledge-conflict`); an absent topic fails closed (`knowledge-not-found`) — retrieval **never fabricates** an answer and **never** silently falls back to general model knowledge.
