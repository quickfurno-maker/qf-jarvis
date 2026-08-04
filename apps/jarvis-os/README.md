# Jarvis OS

The operator control plane for QF Jarvis. See
[`docs/architecture/jarvis-os.md`](../../docs/architecture/jarvis-os.md) for the authority
boundary, the phase track and the deployment topology.

## What this is

A **powerless** read surface. It renders a control-plane read model and holds no business
authority of its own:

- it creates no approval and answers none;
- it sends no communication and reaches no provider;
- it invokes no n8n workflow and calls no Meta API;
- it mutates no QuickFurno Core record and no Jarvis durable state;
- it reads no secret and reaches no database.

QuickFurno Core authorizes. n8n executes. Providers deliver. Jarvis recommends and observes.

## Running it

```
pnpm --filter @qf-jarvis/jarvis-os dev
```

The default surface renders the **repository baseline** described under JOS-01B below, behind the
owner session described under JOS-01C. The synthetic JOS-01A fixture still exists under
`src/lib/demo-data` and is no longer what the application shows by default; every figure in it is
synthetic, and its identifiers carry a `-DEMO-` segment so they cannot be mistaken for production
records.

## Structure

| Path                       | Holds                                                                    |
| -------------------------- | ------------------------------------------------------------------------ |
| `src/app`                  | Routes. One page per navigation entry; server components throughout.     |
| `src/components`           | Shell, navigation, system status, charts, agent and operations surfaces. |
| `src/lib/capabilities`     | The capability catalog and its lifecycle vocabulary.                     |
| `src/lib/control-plane`    | The read-model contracts and the provider boundary.                      |
| `src/lib/demo-data`        | The synthetic JOS-01A fixture. No longer the default surface.            |
| `src/server/auth`          | Owner password, TOTP, session and origin verification (JOS-01C).         |
| `src/server/control-plane` | The repository baseline and the snapshot API (JOS-01B).                  |
| `src/lib/navigation`       | The information architecture, as data.                                   |

**No business decision lives in a React component.** Components consume the read model; the
model decides what a state means. That is what lets JOS-01B swap the demo provider for an API
adapter without touching a screen, and what lets a future Android client reuse the same
conceptual contracts through that API.

## JOS-01B — read-only control-plane contract and snapshot API

The default surface is a **repository baseline**, not the demo fixture. Every operational section
states its own availability (`AVAILABLE`, `STATIC_BASELINE`, `NOT_CONNECTED`, `PLANNED`,
`ROLLOUT_OFF`) with a reason and its expected source, and the contract parser rejects any unavailable
section that carries rows — so an unreadable source can never render as a successful zero.

QuickFurno Core and n8n are both `NOT_CONNECTED`. No live read protocol has been adopted here.

```
merged repository / governance declarations
        |
        v
  buildControlPlaneSnapshot({ generatedAt })   <- pure, validates its own output
        |-- direct call ------> server components
        '-- GET /api/control-plane/v1/snapshot ---------> authenticated clients
```

`generatedAt` records when the JSON envelope was produced and moves on every response.
`source.freshness` records how fresh the underlying FACTS are and stays `BUILD_DECLARATION`:
answering a request re-reads no Git, no governance document, no QuickFurno Core and no n8n. The
contract REJECTS a `REPOSITORY_BASELINE` that claims `REQUEST_TIME` or live data, so request time
can never promote a compiled-in baseline.

Server components call the builder **directly**; they never fetch the route. The route exports only
`GET`, sets `no-store` and `nosniff`, sends **no CORS header**, rejects query parameters, and returns
a generic fail-closed body.

## JOS-01C — owner authentication and operator sessions

Every operator page and the snapshot API require a verified session. `/login` is the only public
page; the route and the protected layout each verify independently, so the proxy is never the only
check. **Still not deployed** — JOS-01D Gate 1 adds the container, the secret mount and the edge
rate limits as reviewable artefacts; Gate 2 deploys them and enables TLS, then HSTS.

Production needs an Argon2id passphrase **and** a TOTP code; there is no password-only production
mode. Sessions are AES-256-GCM encrypted, short-lived (1 hour by default, server-enforced) and
carried in a `__Host-` `Secure` `HttpOnly` `SameSite=Strict` cookie with no `Max-Age`.

Secrets live in ONE read-only JSON file outside the repository. The only environment variable is a
PATH:

```
pnpm --filter @qf-jarvis/jarvis-os auth:bootstrap -- --output ~/.qf-jarvis/jos-auth.json --mode LOCAL_DEVELOPMENT
export QFJ_JOS_AUTH_CONFIG_FILE=~/.qf-jarvis/jos-auth.json
pnpm --filter @qf-jarvis/jarvis-os dev
```

The bootstrap tool never accepts a passphrase on the command line or from the environment, refuses
to overwrite an existing file, refuses to write inside the repository without an explicit override,
and prints the TOTP secret exactly once.

**Revocation is global, not per-session.** Increment `session.revision` or remove a key in the file
and every outstanding session dies on the next request — no restart needed. Per-session revocation
requires a durable session store and MUST be adopted before multi-operator or write-capable use.

The wire contract lives in `@qf-jarvis/control-plane-read-contract` (zod only, no Next/React/Node),
so a future Android client shares it verbatim. No Android files exist yet.

Local: `pnpm --filter @qf-jarvis/jarvis-os dev`, then `curl http://127.0.0.1:3000/api/control-plane/v1/snapshot`.

## JOS-01D — deployment

Container and deployment topology live in [`deploy/jarvis-os/`](../../deploy/jarvis-os/README.md)
(ADR-0088). The image is digest-pinned and tagged by exact Git SHA, the container runs non-root with
a read-only root filesystem and **no published port**, and the auth JSON is bind-mounted read-only
at run time rather than baked into a layer.

**Nothing is deployed by that directory alone.** JOS-01D Gate 1 ships the artefacts and a read-only
host audit; Gate 2 performs the deployment.
