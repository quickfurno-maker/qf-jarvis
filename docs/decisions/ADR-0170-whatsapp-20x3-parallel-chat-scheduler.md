# ADR-0170 — WhatsApp 20×3 governed parallel chat scheduler

**Status:** Accepted
**Date:** 2026-09-25

## Decision

The single-owner QuickFurno WhatsApp worker may admit up to **60 concurrent chat turns**:
20 Riya, 20 Anisha and 20 Aarohi. This is chat concurrency, not an instruction to issue 60
simultaneous provider requests.

The worker keeps one durable shared spool and one process. A round-robin scheduler owns claims,
maintains per-agent lanes, and permits at most one in-flight turn for any conversation. Different
conversations may run concurrently. QuickFurno conversation revisions and final write validation
remain authoritative.

Provider concurrency is an independent bounded model-gateway setting. The reviewed production
shape admits 60 chat turns while allowing 20 provider calls and 40 bounded model waiters. Exact
activation remains dependent on the production provider project's verified RPM/TPM limits.

## Safety invariants

- Deployment remains `SINGLE_OWNER`; this ADR does not authorize horizontal replicas.
- Same-conversation turns never overlap inside the worker.
- Agent lanes are capped independently at 20 and selected round-robin.
- The durable spool can select by agent and exclude active conversations without copying content.
- Provider queue capacity must be large enough to absorb every admitted chat turn or config fails.
- Kill-switch activation stops new claims; already admitted turns retain existing fail-closed model
  behavior.
- Observation writes are serialized so concurrent completions cannot race the same snapshot file.
- Graceful shutdown is extended to 120 seconds; the worker may use up to 1.5 CPU / 2 GiB so the 2-vCPU host retains headroom for ingress, Core and Jarvis OS.

## Scaling beyond this boundary

More than 60 admitted turns or more than one worker replica requires a new certification boundary,
including distributed conversation leasing/partitioning and provider-capacity evidence.
