# QuickFurno WhatsApp production worker

Private Jarvis worker for the QuickFurno conversational WhatsApp path.

## Authority boundary

QuickFurno remains the identity, conversation, privacy/consent, routing, provider-account, send and
business authority. The worker reads the signed QuickFurno authority-v2 contract repeatedly and
produces only a `PENDING_CORE_VALIDATION` proposal. QuickFurno `/whatsapp-reply` performs the final
authorization before any Meta/provider send.

The worker has no public HTTP port and no Traefik router. Production WhatsApp Riya is stateless
inside Jarvis; the worker does not compose the separate Riya continuity or logical-turn stores.

## Parallel chat capacity

The reviewed single-owner worker admits up to **60 simultaneous chat turns**: 20 Riya, 20 Anisha
and 20 Aarohi. Agent lanes are round-robin and a conversation may have only one in-flight turn.
Provider concurrency is deliberately separate: the example config allows 20 simultaneous model
calls plus 40 bounded waiters, so provider limits can be tuned without changing chat isolation.

Do not activate the 60-turn envelope until the production provider project has enough verified
RPM/TPM capacity. A provider rate-limit failure remains fail-closed; this worker does not create an
unbounded retry loop.

## Durable queue

Both containers mount the same host directory:

`/srv/qf-jarvis/state/quickfurno-gateway-turns`

The gateway runs as `10002:10002`. The worker runs as `10003:10002`, sharing only the spool group.
The spool must therefore have gid 10002 and group read/write permission. It must never be
world-writable.

## Knowledge posture

The launch-safe production default is **DISABLED** knowledge.

With `"knowledge": { "mode": "DISABLED" }`:

- no PostgreSQL knowledge database is configured or opened;
- no database CA or embedding credential is mounted;
- no embedding or RAG retrieval call is made;
- no knowledge revision or embedding model identity is invented;
- the production JF-5 evidence must itself be knowledge-unbound;
- prompts must decline or defer QuickFurno business facts that are not supplied by current governed
  Core context rather than filling the gap from model training.

Use `worker-config.example.json` for this posture. Deployment defaults to
`QFJ_WORKER_KNOWLEDGE_MODE=DISABLED`.

HYBRID knowledge is a separately governed capability. Use
`worker-config.hybrid.example.json` and deploy with
`QFJ_WORKER_KNOWLEDGE_MODE=HYBRID`. That mode additionally requires:

- `/srv/qf-jarvis/secrets/embedding-production.key` for HOSTED embeddings;
- `/srv/qf-jarvis/secrets/postgres-ca.pem`;
- an exact immutable SEALED production knowledge revision;
- a reviewed approved corpus;
- JF-5 evidence bound to that exact knowledge revision and embedding/model configuration.

Switching from DISABLED to HYBRID creates a new certification lineage; it is not a configuration-only
activation.

## Base runtime files

Install these before deployment; do not commit their real contents:

- `/srv/qf-jarvis/secrets/qf-jarvis-whatsapp-worker.json` — bounded config; owner
  `10003:10002`, mode 0400 or 0600.
- `/srv/qf-jarvis/secrets/quickfurno-signing.key` — Jarvis Ed25519 private key for worker →
  QuickFurno signing; owner `10003:10002`, mode 0400 or 0600.
- `/srv/qf-jarvis/secrets/groq-production.key` — Groq credential only; owner
  `10003:10002`, mode 0400 or 0600.
- `/srv/qf-jarvis/seals/jf5c-production-seal.json` — exact-head JF-5C v2 seal; owner
  `10003:10002`, mode 0400 or 0600.
- `/srv/qf-jarvis/state/quickfurno-worker-control/DISABLE_MODEL` — emergency/startup kill switch.

There is no managed-Riya persistence-decision file in the WhatsApp production deployment.

## Release sequence

1. Merge through protected `main`.
2. Select the knowledge posture:
   - DISABLED: run exact-head JF-5B with no knowledge revision.
   - HYBRID: first approve/build/seal the corpus, then run exact-head JF-5B bound to its exact revision.
3. Riya, Anisha and Aarohi must all PASS the applicable live certification suite.
4. Obtain the three blinded human ACCEPT reviews and owner ACCEPT.
5. Mint the matching exact-head JF-5C v2 seal.
6. Install the config/base secrets and create `DISABLE_MODEL` with `disable.sh`. Install the
   embedding credential and PostgreSQL CA only for HYBRID.
7. Deploy the exact merged SHA:
   - DISABLED: `deploy.sh <sha>`
   - HYBRID: `QFJ_WORKER_KNOWLEDGE_MODE=HYBRID deploy.sh <sha>`
8. Deploy the matching reviewed QuickFurno SHA/config, still fail-closed.
9. Verify the disabled deployment proof and Jarvis OS knowledge posture.
10. Only after explicit operator approval, run `activate.sh <sha>`.
11. Run one real Meta WhatsApp canary. On any uncertainty, run `disable.sh` before investigation.

There is deliberately no automatic activation in the deployment script.

## Read-only operational observation

The worker writes a bounded, content-free
`qfj.quickfurno-worker-observation.v3` snapshot to
`/srv/qf-jarvis/state/observability/whatsapp-worker.json` through
`/var/run/qfj-observability`.

The snapshot reports the knowledge plane explicitly:

- `{ "mode": "DISABLED" }`; or
- `{ "mode": "HYBRID", "revision": "...", "embeddingModelRef": "..." }`.

It never contains message text, conversation ids, subject ids, credentials, authorization results or
model output. In DISABLED mode it contains no fabricated knowledge revision or embedding identity.

Jarvis OS may mount that file/directory read-only and set `QFJ_WORKER_OBSERVATION_FILE` to the
mounted absolute path. The adapter rejects stale (>30s), malformed or content-bearing snapshots and
owns only headline metrics, worker/model/knowledge health and model latency. It receives no database
or QuickFurno credential.
