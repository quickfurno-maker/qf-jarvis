# Report 02 — Processing Order and Double-Gate Proof

**Slice:** QFJ-M2 — Core Decision and Reply Orchestration Foundation. **ADR:** [ADR-0055](../../decisions/ADR-0055-qfj-m2-core-decision-and-reply-orchestration.md).

## Fail-closed processing order

`orchestrateInbound` walks the ADR §C order and **any failure prevents every later stage** (proven — the injected model and Core fakes record their invocation counts, which stay at zero when a gate blocks):

| Blocking condition                             | Reason                                                                 | Model invoked | Core invoked |
| ---------------------------------------------- | ---------------------------------------------------------------------- | ------------- | ------------ |
| Envelope ≠ context (conversation/tenant/party) | `orchestration-envelope-invalid`                                       | 0             | 0            |
| Human takeover                                 | `orchestration-human-takeover`                                         | 0             | 0            |
| AI pause                                       | `orchestration-ai-paused`                                              | 0             | 0            |
| Non-AI assignment / cancelled context          | `orchestration-human-takeover` / `orchestration-cancelled`             | 0             | 0            |
| HUMAN_ONLY                                     | `orchestration-human-only`                                             | 0             | 0            |
| LOCAL_ONLY on a hosted-only model              | `orchestration-data-class-unserviceable`                               | 0             | 0            |
| Missing privacy gate / blocked subject         | `orchestration-privacy-gate-missing` / `orchestration-subject-blocked` | 0             | 0            |
| Knowledge refusal                              | `orchestration-knowledge-refused`                                      | 0             | 0            |
| Missing model port                             | `orchestration-model-unavailable`                                      | 0             | 0            |
| Required evaluation ref absent                 | `orchestration-evaluation-mismatch`                                    | 0             | 0            |
| Malformed / fabricated-citation draft          | `orchestration-draft-invalid`                                          | 1             | 0            |

The privacy gate runs **before** any knowledge or model access; `HUMAN_ONLY` never reaches a model; `LOCAL_ONLY` never reaches a hosted interface. The valid path is deterministic (same inputs → identical result).

## The double gate

Immediately **before the Core decision**, the orchestrator re-reads the conversation context and re-checks it. A state change after model drafting **invalidates the proposal and prevents Core acceptance** — the model was invoked (once) but Core is **not** (proven):

| Change after drafting     | Reason                          | Core invoked |
| ------------------------- | ------------------------------- | ------------ |
| Human takeover            | `orchestration-human-takeover`  | 0            |
| AI pause                  | `orchestration-ai-paused`       | 0            |
| Cancellation              | `orchestration-cancelled`       | 0            |
| Revision bump             | `orchestration-stale-revision`  | 0            |
| Subject becomes blocked   | `orchestration-subject-blocked` | 0            |
| Party (assignment) change | `orchestration-stale-revision`  | 0            |
