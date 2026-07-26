# Report 02 — Credential Ingress and No-Secret-Leak Proof

**Slice:** QFJ-S1A. **ADR:** [ADR-0061](../../decisions/ADR-0061-qfj-s1a-groq-staging-smoke-activation-enablement.md) §B, §H.

## Where the credential can enter

Exactly one place: a key typed at an **interactive terminal with echo disabled**, read once, wrapped
immediately in the existing redacting `GroqApiKey`.

`packages/groq-staging-smoke/src/masked-tty-credential-resolver.ts`

| Rule                                 | Enforcement                                                                                                                                                                               | Test                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Never through `argv`                 | The command surface accepts only `--config <path>`; any other token is refused **without being echoed**.                                                                                  | `one-shot.test.ts` (27)                   |
| Never through the configuration file | A key/secret/token/password-shaped field is rejected as a forbidden field class before any value is read.                                                                                 | `config-traceability.test.ts` (17)        |
| Never from the environment           | The package contains no `process.env`, no `import.meta.env`, no `dotenv`. Scanned mechanically over every production file.                                                                | `containment.test.ts` (12)                |
| Never written to disk                | The package contains no `writeFile*`, `appendFile*`, `createWriteStream`, `mkdir*`, or `rm*`. `node:fs` is imported by exactly one module (`config.ts`) and only for a read.              | `containment.test.ts` (13)                |
| Interactive TTY required             | `isInteractive()` requires both `process.stdin.isTTY` and `process.stdout.isTTY`. Checked by the harness **before the resolver is even constructed**, and re-checked inside the resolver. | `credential-ingress.test.ts` (6)          |
| Echo disabled                        | `setRawMode(true)`, `data` accumulated in memory, nothing written back — not the characters, not a mask, not a length. Restored in every exit path.                                       | design + `credential-ingress.test.ts` (7) |
| Bounded and validated                | 20–200 characters, `^[A-Za-z0-9_-]+$`. No provider prefix is asserted (a sentinel must remain usable).                                                                                    | `credential-ingress.test.ts` (9)          |
| Exactly one read                     | A second `resolve` returns `smoke-credential-invalid` without touching the terminal.                                                                                                      | `credential-ingress.test.ts` (8)          |
| No accessor                          | The resolver's own keys are exactly `lastFailure`, `reads`, `resolve`, and the object is frozen. `GroqApiKey` redacts through `toString`, `toJSON`, and the Node inspect hook.            | `credential-ingress.test.ts` (10, 11, 14) |
| Buffer cleared                       | The accumulating `string[]` is `fill('')`-ed and truncated once the value is built — as much erasure as the runtime permits, since the resulting string is immutable.                     | design                                    |
| Process-memory only                  | Nothing persists it; the one-shot process exits.                                                                                                                                          | design                                    |

## Ordering: the TTY gate runs first

```
runGroqStagingSmokeOnce
  └─ deps.credentialSource.isInteractive()   ← FIRST. false → smoke-tty-required, resolver never built
  └─ createMaskedTtyCredentialResolver(...)
  └─ bindGroqStagingProvider(...)
        ├─ wildcard identity / execution class / data class   ← privacy gates
        ├─ prompt identity / approval references              ← QFJ-S1A gates
        ├─ data-controls attestation
        └─ credentialResolver.resolve(...)                    ← the ONLY read, and only if all gates passed
```

A piped or redirected session therefore never reaches a prompt, and a key can never end up in a shell
pipeline. Asserted: `source.reads() === 0`, `counters.credentialReads === 0`, `transport.calls() === 0`.

## Sanitized failure, never a cause

The resolver rejects with the fixed message `QFJ_SMOKE_CREDENTIAL_REFUSED`. It quotes no path, no cause,
no reference, and no typed character. The gateway binding collapses every resolver rejection to
`groq-bind-credential-unavailable`; the harness reads the resolver's own more specific sanitized code
(`smoke-credential-invalid` or `smoke-tty-required`) and reports that instead. The fixed message itself
never reaches the outcome — asserted.

## Non-leak assertions

For both a successful and a refused run, the serialized result **and** the printed report are checked to
contain none of:

- the sentinel credential, or the substring `FAKE-STAGING-SENTINEL`;
- `Bearer`, or the string `authorization` in any case;
- the opaque credential **reference value** (`groq.staging.secret.v1`);
- the rejected input value, or the resolver's internal error message.

**Positive control.** The same test asserts the credential _did_ reach the wire correctly: the recorded
fake-transport request carries exactly two headers (`authorization`, `content-type`), the authorization
value begins `Bearer `, and the request **body** does not contain the credential. That record lives
inside the deterministic fake transport — never in a harness surface, a log, an event, or a report.

## What still must not be done

No real key is read, created, rotated, stored, printed, or validated by this slice. No secret store,
Windows Credential Manager, cloud secret manager, Groq console, or provider account is touched. Every
test injects a scripted terminal; the real `createNodeMaskedSecretSource` is never imported into a run
by any spec, which is itself asserted.
