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

JOS-01A renders a **local demo read model** — every figure is synthetic, and identifiers carry
a `-DEMO-` segment so they cannot be mistaken for production records. There is no
control-plane API in this release.

## Structure

| Path                    | Holds                                                                    |
| ----------------------- | ------------------------------------------------------------------------ |
| `src/app`               | Routes. One page per navigation entry; server components throughout.     |
| `src/components`        | Shell, navigation, system status, charts, agent and operations surfaces. |
| `src/lib/capabilities`  | The capability catalog and its lifecycle vocabulary.                     |
| `src/lib/control-plane` | The read-model contracts and the provider boundary.                      |
| `src/lib/demo-data`     | The synthetic snapshot this release renders.                             |
| `src/lib/navigation`    | The information architecture, as data.                                   |

**No business decision lives in a React component.** Components consume the read model; the
model decides what a state means. That is what lets JOS-01B swap the demo provider for an API
adapter without touching a screen, and what lets a future Android client reuse the same
conceptual contracts through that API.
