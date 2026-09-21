# QuickFurno WhatsApp production worker

Private Jarvis worker for the QuickFurno conversational WhatsApp path.

## Authority boundary

QuickFurno remains the identity, conversation, privacy/consent, routing, provider-account, send and
business authority. The worker reads the signed QuickFurno authority-v2 contract repeatedly and
produces only a `PENDING_CORE_VALIDATION` proposal. QuickFurno `/whatsapp-reply` performs the final
authorization before any Meta/provider send.

The worker has no public HTTP port and no Traefik router.

## Durable queue

Both containers mount the same host directory:

`/srv/qf-jarvis/state/quickfurno-gateway-turns`

The gateway runs as `10002:10002`. The worker runs as `10003:10002`, sharing only the spool group.
The spool must therefore have gid 10002 and group read/write permission. It must never be
world-writable.

## Runtime files

Install these before deployment; do not commit their real contents:

- `/srv/qf-jarvis/secrets/qf-jarvis-whatsapp-worker.json` — worker config including Jarvis signing
  key and QuickFurno base URL; owner `10003:10002`, mode 0400 or 0600.
- `/srv/qf-jarvis/secrets/groq-production.key` — Groq credential only; owner `10003:10002`, mode
  0400 or 0600.
- `/srv/qf-jarvis/seals/jf5c-production-seal.json` — exact final JF-5C v2 seal; owner
  `10003:10002`, mode 0400 or 0600.
- `/srv/qf-jarvis/secrets/postgres-ca.pem` — database CA; owner `10003:10002`, mode 0400 or 0600.
- `/srv/qf-jarvis/state/quickfurno-worker-control/DISABLE_MODEL` — emergency/startup kill switch.

The example JSON is shape-only. Production must use `verify-full` database TLS.

## Release sequence

1. Merge the worker through protected `main`.
2. Run fresh exact-head Groq-only JF-5B: Riya, Anisha and Aarohi must all PASS.
3. Obtain the three blinded human ACCEPT reviews and owner ACCEPT.
4. Mint the exact-head JF-5C v2 seal.
5. Install the seal/config/key/CA and create `DISABLE_MODEL` with `disable.sh`.
6. Deploy the exact merged SHA with `deploy.sh <sha>`. This starts the worker **disabled**.
7. Deploy the matching reviewed QuickFurno SHA/config, still fail-closed.
8. Verify the disabled deployment proof.
9. Only after explicit operator approval, run `activate.sh <sha>`.
10. Run one real Meta WhatsApp canary. On any uncertainty, run `disable.sh` before investigation.

There is deliberately no automatic activation in the deployment script.
