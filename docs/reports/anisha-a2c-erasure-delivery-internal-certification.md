# AN-A2c — Anisha Memory Erasure Delivery and Core Acknowledgement

Date: 12 October 2026 IST. Status: internal implementation + mocked/SQL-port tests PASS; NOT merged, NOT deployed, NOT live-database-certified.

## Protocol and authority

QuickFurno Core revocation immediately sets vendor-purpose consent to DENIED. The durable Core outbox stores pending deletion requests; vendor deletion now also queues a task that survives deletion of the vendor record.

New distinct Ed25519-signed CLAIM and ACK Core endpoints require the existing Jarvis verification keys, exact request IDs, vendor IDs and per-task lease tokens. Core leases up to 10 tasks for 120 seconds. ACK only completes a matching, pending, unexpired claim. Outbox retries occur when a claim expires; Core keeps consent denied until receipt.

Jarvis has a standalone stage-only deletion loop, DISABLED by default, independently of memory reads. Each task is processed transactionally in the existing governed-memory PostgreSQL store: acquire vendor advisory lock, insert durable erasure fence, delete vendor's derived memory and COMMIT. Only a successful commit permits Core acknowledgement; failure does not ACK and Core retries. Repeated delete after lost ACK returns zero, safely.

The SQL erasure-fence trigger takes the same advisory lock during Anisha memory INSERT/UPDATE, rejecting late writes that would recreate purged preferences.

## Local verification

Jarvis: 191/191 focused tests across 11 suites PASS; TypeScript with a temporary local source-resolution override PASS (active workspace symlinks point to older prebuilt .d.ts; CI must rebuild the linked store). Core: consent harness 22/22, purge harness 27/27 PASS; Core TypeScript PASS.

Read-only staging inventory: QuickFurno Staging does not yet contain the new consent/outbox tables. QF-Jarvis has no governed-memory table/fence. No schema migration, data change, real WhatsApp send, production config or actual DB erase was performed.

## Prerequisites for staging certification

Review and merge stacked PRs, prepare backed-up isolated staging Postgres, apply both Core migrations and Jarvis governed-memory 0001/0002 source migrations; verify migration ledger and grants. Test opt-in -> bounded read/write -> revoke -> Core leased task -> transactional physical erase -> ACK; test concurrent write, stale lease, DB failure, lost acknowledgement, idempotence and retention expiry with actual database rows. Obtain approved vendor privacy disclosure and consent UI, owner policy, and explicit re-enrollment authorization that safely lifts a past fence after a new grant.

A pending purge task is never a deletion receipt. Memory stays OFF in production and stage until all gates pass.
