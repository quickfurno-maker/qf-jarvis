# Phase 13 — Secrets, Config & Service Discovery

## Status

Implementation branch: `feat/scale-phase13-secrets-config-service-discovery`.

Phase 13 makes Jarvis runtime configuration portable across hosts and networks while
preserving the QuickFurno authority boundary. Runtime secrets are external to OCI
images; deployment identity and endpoint discovery are explicit configuration.

## Versioned deployment identity

Production manifests identify the environment, config schema and stable service:

- `qf-jarvis.quickfurno-gateway`
- `qf-jarvis.whatsapp-worker`
- `qf-jarvis.jarvis-os`

The gateway runtime fails closed when production identity is missing/mismatched.
Gateway and WhatsApp worker JSON are strict/versioned. Jarvis OS auth was already
versioned and has an explicit PRODUCTION mode.

## Secret boundary

Jarvis continues to prefer read-only mounted secret/config files:

- gateway machine-auth JSON + database JSON + CA;
- WhatsApp worker config + model credential + QuickFurno signing key + CA;
- Jarvis OS auth/core read/core command JSON;
- provider/model credentials remain file-backed.

No secret-manager SDK is required by domain code. A future Vault/AWS/Kubernetes
integration only needs to materialize the same mounted files.

The root Docker context now excludes dotenv files, secret directories and private
credential file extensions. Production Dockerfiles have no secret-bearing build
arguments.

## Service discovery

The WhatsApp worker's QuickFurno endpoint is part of its versioned runtime JSON.
For staging/production it must be a root HTTPS DNS name; literal IP targets,
credentials in URLs and path-specific origins are refused. Local mode alone may use
loopback HTTP.

Moving QuickFurno between hosts/networks therefore changes DNS/config only.

## Rotation

QuickFurno → Jarvis gateway verification accepts a bounded key ring of up to four
unique Ed25519 public keys. Jarvis OS sessions independently support PRIMARY plus
VERIFY_ONLY keys.

Zero-downtime machine-signing rotation:

1. Add the new public key alongside the old receiver key.
2. Prove old and new signatures verify during overlap.
3. Switch the sender key ID/private-key file.
4. Prove traffic with the new key.
5. Remove the old public key after the overlap window.

This needs no OCI rebuild.

## Dynamic policy boundary

Deployment config owns identity, endpoints, credentials and runtime resource wiring.
Lead/matching/credit/consent/provider authority remains in QuickFurno. Jarvis agent
policy, model policy and human-takeover behavior remain governed runtime/business
policy, not service discovery.

## Certification

`pnpm run test:scale:phase13` proves:

- strict versioned gateway and worker configuration;
- explicit production service identity;
- file-mounted secret containment;
- Docker context secret exclusion;
- DNS-only non-local service discovery;
- two-host config relocation behavior;
- overlapping Ed25519 verification and new-key-only cutover;
- Jarvis OS PRIMARY/VERIFY_ONLY rotation support.

Full `pnpm check` also includes the Phase 13 source contract.

## Deployment and rollback

No production host/network migration is required to merge Phase 13. Existing
production topology may continue unchanged.

Rollback uses the previous signed image and its matching external configuration.
Secrets remain external and may be rotated independently of code/image rollback.
