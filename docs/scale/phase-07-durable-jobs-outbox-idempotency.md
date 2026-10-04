# Phase 07 — Durable Jobs, Outbox & Idempotency

## Authority

Jarvis does not own QuickFurno business effects. QuickFurno Core/PostgreSQL remains the durable authority.

Jarvis durable responsibilities are deliberately narrower:

- one durable execution-replay claim for effect-bearing Core automation requests;
- one durable opaque QuickFurno → Jarvis turn spool;
- durable logical-turn coordination for Riya;
- failure/uncertainty states that refuse unsafe automatic re-execution.

Redis/Valkey stays ephemeral coordination only.

## Existing durable foundations certified in Phase 07

### Execution replay guard

Migration `0010_execution_replay_claim.sql` keeps one immutable row per execution intent and an independent UNIQUE idempotency key. Real PostgreSQL contention tests prove exactly one `first-seen` winner and read-only reconciliation for losers. Database uncertainty throws and never guesses permission to execute.

### QuickFurno turn spool

Migration `0017_quickfurno_durable_turn_spool.sql` stores only opaque turn identity in PostgreSQL. Claims use `FOR UPDATE SKIP LOCKED`; identity columns are not runtime-updatable; DELETE/TRUNCATE are unavailable to the runtime role.

The integration suite proves:

- one durable turn has one concurrent claimant;
- separate workers claim distinct turns;
- accepted work survives pool/process restart;
- stale PROCESSING work can be recovered;
- queue depth and oldest pending age are observable.

### Uncertain outcomes

The production turn processor differentiates pre-agent failures from post-agent uncertainty:

- before an agent/Core run, retryable transport failure may release the turn;
- after an agent/Core run or callback uncertainty, the turn fails indeterminate and is never automatically re-run.

Aarohi uses the same safety principle around provider execution.

## Concurrency, backpressure and drain

The WhatsApp production scheduler bounds global and per-agent concurrency, prevents simultaneous processing of the same conversation inside a worker, and waits for all in-flight promises when its AbortSignal is triggered.

Worker observations are emitted per runtime ID and include spool pending/processing/completed/failed counts plus oldest pending age. This is the Jarvis queue-age/pressure signal for horizontal scaling decisions.

## Phase 07 rule

Future queue technologies may accelerate wake-up or delivery, but the PostgreSQL replay/turn records remain the recovery authority. No SQS/Kafka/PubSub/Redis acknowledgement is allowed to become the only durable record of business intent.
