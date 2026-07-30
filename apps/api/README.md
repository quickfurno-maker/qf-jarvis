# `@qf-jarvis/api`

The synchronous, request-driven boundary of QF Jarvis.

## Status

[`src/index.ts`](src/index.ts) is still a documentation comment and `export {};` — there is no HTTP server, no framework, no route, and no health check, and this application still exports nothing from its package root. The two executables below are `bin` entries, not an API.

The boundary exists so that the module structure of the modular monolith is real from the first commit rather than retrofitted onto working code later ([ADR-0004](../../docs/decisions/ADR-0004-modular-monolith-first.md), [ADR-0010](../../docs/decisions/ADR-0010-workspace-and-module-structure.md)). An empty boundary that compiles is a structure. A placeholder implementation is a liability — it is indistinguishable from an intention, and it will be built upon by someone who assumes it was.

### QFJ-S2-D-B — production credential acquisition

[`src/secrets/`](src/secrets) is the first content here. It acquires the **model-inference** credential from a mounted file and hands it to the existing `GroqCredentialResolver` seam ([ADR-0064](../../docs/decisions/ADR-0064-production-credential-binding.md)).

It lives here because reusable packages receive configuration explicitly and read no environment; only an **executable process boundary** acquires deployment configuration. That rule is stated in [`database-config.ts`](../../packages/event-backbone/src/persistence/database-config.ts) and is why `@qf-jarvis/model-gateway` stays a pure library.

Nothing is activated: no provider is constructed, no transport is opened, no `process.env` is read, and the production model-gateway composition remains OFF-only.

### QFJ-S2-E-B — the controlled SHADOW one-shot runner

[`src/shadow/`](src/shadow) composes a **process-local** gateway that runs one SHADOW validation and then disables itself ([ADR-0065](../../docs/decisions/ADR-0065-controlled-shadow-validation-at-the-process-boundary.md)). `createProductionModelGateway` is untouched and remains OFF-only; the runner calls `createModelGateway` directly and owns its rollout controller, which it never exposes.

Two executables exist, both single-shot and both offline unless given a real credential file:

| Bin                            | What it does                                                                                                                                                                                                                                       | Credential        |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `qfj-generate-shadow-evidence` | Builds `SHADOW_ELIGIBILITY` evidence (`synthetic=true`, `productionApproval=false`) through the real `@qf-jarvis/model-evaluation` factories and prints its deterministic digest. The artifact goes to stdout; the one result line goes to stderr. | never touched     |
| `qfj-run-shadow-once`          | Runs `OFF → SHADOW → OFF` once: one stable call, one candidate shadow call, then `emergencyDisable`. Emits one closed JSON line.                                                                                                                   | read exactly once |

```
qfj-generate-shadow-evidence --config <abs>.json > evidence.json

qfj-run-shadow-once \
  --config <abs>.json \
  --evidence <abs>.json \
  --credential-file <abs>.key \
  --expected-config-digest <hex> \
  --expected-evidence-digest <hex>
```

Both digests are **recomputed** from the loaded files and compared before the credential file is opened, so a misconfigured invocation never reads a secret. Every path argument must be absolute; no flag accepts a credential value, a prompt, a retry count, an endpoint, or a header.

The prompt and the strict result schema are fixed in [`src/shadow/shadow-request.ts`](src/shadow/shadow-request.ts) and cannot be supplied at runtime. Both model outputs are discarded — the result line reports `modelOutput: DISCARDED` and carries no digest, no length, no path, no reference and no prompt. A candidate failure is a runner `FAIL` even though the gateway returns the stable response successfully.

**The credential file path appears in the operating-system process list** (`ps`, Task Manager) because it is a command-line argument. The application never prints it. This is a deliberate trade: an argument is auditable and explicit, whereas an environment variable is inherited by children and a stdin prompt cannot be automated safely.

Running either executable against a real credential or a real provider requires a **fresh, single-use owner authorisation** (S2-E-C). Nothing here schedules, retries or repeats a run.

## What this application is for

Eventually: the request-driven surface of Jarvis — the founder control plane's backing API, recommendation queries, and evidence retrieval.

When each of those arrives is decided by [the phased roadmap](../../docs/architecture/phased-roadmap.md), not by whoever needs somewhere to put something. A web framework is not chosen here until a phase actually requires one.

## What this application may never do

The [permanent architecture boundary](../../docs/architecture/system-boundary.md) is authoritative and applies to every line ever added here:

- It may not authorize anything, including its own recommendations.
- It may not call n8n, or any external provider.
- It may not write QuickFurno Core's business state.
- It may not hold an **execution or communication** provider credential — WhatsApp, SMS, email, voice, telephony, CRM, or advertising. It has none and must never be given any.
- It may not render an action as approved, delivered, or complete before Core's authoritative result returns.

The distinction is authoritative, not local to this README: [`system-boundary.md` § Two kinds of provider credential](../../docs/architecture/system-boundary.md#two-kinds-of-provider-credential) defines it. **Execution and integration credentials remain forbidden to Jarvis entirely** and stay with n8n or the relevant execution service. The single **model-inference** credential exception is confined to an executable process boundary under [ADR-0064](../../docs/decisions/ADR-0064-production-credential-binding.md), may never enter Core state, agent memory, a prompt, an event, a log, provenance, a report or a database row, and grants no execution authority whatsoever.

## Commands

Run from the repository root:

```
pnpm --filter @qf-jarvis/api typecheck
pnpm --filter @qf-jarvis/api build
```

Or check and build the whole workspace with `pnpm check`. See [development setup](../../docs/engineering/development-setup.md).
