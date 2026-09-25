# ADR-0166 — Exact-release assurance observation for Jarvis OS

- **Status:** Accepted
- **Date:** 2026-09-25
- **Owners:** QF Jarvis
- **Scope:** Jarvis OS release verification, Evaluations surface, web/mobile operator API

## Context

Jarvis OS now consumes live worker and QuickFurno operational observations, but the Evaluations surface must not infer release health from repository text or from a request timestamp. External TLS, ingress, HSTS and public-port containment are facts established only by the staged release smoke, and those checks deliberately run from the operator machine rather than from the VPS.

A dashboard that displayed those checks as live without a durable exact-release binding could accidentally reuse evidence from an older image. A dashboard that pulled GitHub/CI credentials into the web container would widen the control plane for no operational benefit.

## Decision

The final verified external smoke remains external. When and only when the exact-SHA final smoke succeeds, its reviewed wrapper invokes the immutable release package's host-side assurance publisher over the operator's authenticated SSH channel.

The host-side publisher independently re-verifies:

- the SHA is merged and the release directory is byte-for-byte the immutable package for that SHA;
- the running Jarvis OS image revision equals that SHA;
- the container is healthy;
- public ingress and the reviewed one-year HSTS middleware are active;
- the release-assurance mount is the reviewed host directory and is read-only in the container; and
- the container's public release-SHA environment binding equals the same SHA.

Only then may it atomically replace the bounded content-free receipt at
`/srv/qf-jarvis/state/release-assurance/current.json`.

Jarvis OS reads that receipt through a dedicated framework-neutral observation contract. The read source refuses malformed, future-dated or wrong-SHA receipts. Receipt content can report assurance state only; it cannot authorize a rollout, approve an action, change configuration or carry raw logs.

## Mobile consequence

The assurance information enters the same Control Plane Snapshot V2 consumed by web and the future native client. Mobile therefore receives the same provenance and cannot reinterpret a cached receipt as a newer release. No GitHub, Docker, SSH or deployment credential is ever shipped to a client.

## Evaluation-count rule

The current snapshot contract does not carry numeric case counts for evaluation dimensions. The presentation layer must render an unknown count as `—`, never `0`. A future contract version may add measured case totals explicitly; they must not be inferred from release assurance.

## Security consequence

The assurance directory is non-secret but root-writable and mounted read-only into Jarvis OS. Atomic directory-visible replacement avoids the stale-inode defect of single-file bind mounts. Old receipts remain harmless because their embedded SHA no longer matches the running release.

## Result

The Evaluations surface can report genuine, durable release-assurance evidence without turning Jarvis OS into a deployment system and without weakening the external nature of the final release check.
