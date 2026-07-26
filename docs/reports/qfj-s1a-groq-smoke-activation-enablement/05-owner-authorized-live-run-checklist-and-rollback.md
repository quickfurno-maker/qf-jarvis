# Report 05 — Owner-Authorized Live-Run Checklist and Rollback

**Slice:** QFJ-S1A. **ADR:** [ADR-0061](../../decisions/ADR-0061-qfj-s1a-groq-staging-smoke-activation-enablement.md) §J.

## Where S1A stops

S1A is **code only**. It clears the four blockers and stops. It reads no credential, contacts no network,
and consumes none of the owner authorization already on record. The single synthetic staging smoke is a
separate, later task that runs **after** this pull request is reviewed and merged.

## What the owner must still supply (none of it is in the repository)

None of the following was accessed, printed, validated, created, rotated, or stored by this slice.

| #   | Input                                                                              | Where it goes                                                                                                             |
| --- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| P1  | A **staging** (never production) Groq key                                          | Typed once at the masked terminal prompt. Never argv, never a file, never an environment variable, never a shell command. |
| P2  | The opaque credential reference (a secret name/version **identifier**)             | `credentialReference` in the configuration file. An identifier, not a secret.                                             |
| P3  | The exact `releaseId` / `providerId` / `modelId` / `modelVersion` / `configDigest` | `release` in the configuration file.                                                                                      |
| P4  | The approved `maxInputTokens` / `maxCompletionTokens`                              | The configuration file.                                                                                                   |
| P5  | The exact `capabilityProfileRef` (ADR-0050)                                        | The configuration file.                                                                                                   |
| P6  | The exact `evaluationRef` (ADR-0052)                                               | The configuration file.                                                                                                   |
| P7  | The exact `dataControlsAttestationRef`, with a confirmed positive ZDR attestation  | The configuration file, alongside `dataControlsAttested: true`.                                                           |
| P8  | The approved `timeoutMs` (1 000–120 000 ms)                                        | The configuration file.                                                                                                   |

The prompt and the strict schema are **not** owner inputs — they are compiled into the harness and the
configuration must match their family/version/revision exactly.

## The configuration file (non-secret, strictly closed)

```json
{
  "credentialReference": "<P2 — an identifier, never a key>",
  "release": {
    "releaseId": "<P3>",
    "providerId": "<P3>",
    "modelId": "<P3>",
    "modelVersion": "<P3>",
    "executionClass": "HOSTED",
    "configDigest": "<P3>"
  },
  "dataClass": "HOSTED_ALLOWED",
  "maxInputTokens": 8192,
  "maxCompletionTokens": 256,
  "supportsStrictJsonSchema": true,
  "capabilityProfileRef": "<P5>",
  "evaluationRef": "<P6>",
  "dataControlsAttestationRef": "<P7>",
  "dataControlsAttested": true,
  "promptFamily": "qfj.s1a.synthetic.smoke",
  "promptVersion": 1,
  "schemaRevision": "qfj.s1a.synthetic.smoke.schema.v1",
  "timeoutMs": 30000
}
```

Any additional key is rejected. A key/secret/token/password field, a prompt/message/output field, and a
URL/endpoint/header/provider-option field are each rejected as a forbidden field class, without the value
being read.

## Precondition gate

- [ ] This pull request is **reviewed and merged** by the owner.
- [ ] The owner confirms the already-recorded authorization statement still stands and is being consumed
      now, for **one** synthetic non-production request.
- [ ] The key in hand is a **staging** key, confirmed not production.
- [ ] A positive data-controls (ZDR) attestation exists for that exact release, and its reference is P7.
- [ ] P2–P8 are prepared as a configuration file — **not** as command arguments.
- [ ] The session is a real interactive terminal (not CI, not a pipe, not a redirect).

## Run

```
pnpm build
node packages/groq-staging-smoke/dist/bin.js --config <path-to-non-secret-config.json>
```

The harness prompts once, with echo disabled. **Type the staging key at the prompt.** Do not paste it
into a command, an environment variable, a file, or a chat message.

Then it binds once, invokes once, prints the sanitized report, and exits.

## Success criteria

All of:

- `outcome=PASS` and `reason=smoke-completed`;
- `binds=1`, `credentialReads=1`, `invocations=1`, `timersArmed=1`, `timersCleared=1`;
- exactly one HTTP request, to `https://api.groq.com/openai/v1/chat/completions`;
- `modelOutput=DISCARDED` and `authority=QUICKFURNO_CORE` present;
- the report contains no key, no credential reference value, no prompt text, and no model output;
- exit code `0`.

## Fail criteria — record the sanitized code only

| Code                                  | Meaning                                                                                                                                                   |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `smoke-config-invalid`                | Bad argv, or an unreadable/non-JSON/schema-failing configuration. Exit 2.                                                                                 |
| `smoke-config-secret-field-forbidden` | The configuration carried a forbidden field class. Exit 2. **Rotate nothing; remove the field.** If it was a real key, treat it as exposed and rotate it. |
| `smoke-tty-required`                  | Not an interactive terminal. Nothing was read.                                                                                                            |
| `smoke-credential-invalid`            | The typed value failed the bounded check, or a second read was attempted.                                                                                 |
| `smoke-bind-refused`                  | A gateway gate refused; `bindReason` names which.                                                                                                         |
| `smoke-timeout`                       | The harness timer fired and aborted the single request.                                                                                                   |
| `smoke-cancelled`                     | Cancelled without the harness timer firing.                                                                                                               |
| `smoke-provider-failed`               | Normalized non-retryable provider failure (for example 401/404).                                                                                          |
| `smoke-provider-unavailable`          | Normalized retryable unavailability (429, 5xx, network). **Do not re-run to "get a green".**                                                              |
| `smoke-provider-malformed`            | The response failed strict structural validation.                                                                                                         |
| `smoke-invariant`                     | A harness bug. Stop and fix the harness.                                                                                                                  |

`bindReason` may additionally be any of the nine `GROQ_STAGING_BIND_REASONS`, including the two added by
this slice: `groq-bind-prompt-invalid` and `groq-bind-approval-refs-missing`.

## Stop and cleanup

- **Run once.** Do not invoke a second time under any outcome, including a 429 or a 5xx.
- Do not activate the provider, promote any rollout, or register anything.
- Do not contact QuickFurno Core, n8n, or WhatsApp. Do not send, deliver, or persist anything.
- Discard the model output — it is a draft with no business authority.
- Do not commit the configuration file if it sits inside the repository; prefer a path outside it.
- The process exits and the key leaves memory with it. Nothing persistent was created, so there is
  nothing to delete.
- Confirm afterwards: no rollout transition, no provider registration, no configuration change, no file
  written containing prompt/output/credential material, and no secret in shell history.

## Rollback

Nothing is written, so there is nothing to undo. Abort at any point by pressing Ctrl-C at the prompt or
letting the timer expire; the harness restores terminal echo in every exit path.

**If there is any doubt that a production (not staging) credential was used, stop immediately, rotate
that credential through the normal owner-controlled process, and escalate before any further action.**

## After the smoke test

In order, each separately authorized: QuickFurno Core-side M3 protocol adoption → a Core-approved
delivery command with n8n/WhatsApp transport → authoritative persistence and delivery states → the
minimum Conversation Operations Center → a controlled pilot.

Managed database, migration, and live lanes remain paused. RAG stays disabled. Kimi remains excluded.
Migrations `0001`–`0007` stay byte-exact with no `0008`. The `@qf-jarvis/event-backbone` root API remains 39. **QuickFurno Core remains the final business authority and system of record.**
