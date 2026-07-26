# Report 04 — Tests, API, dist, Dependency, CI, and Containment Evidence

**Slice:** QFJ-S1A. **ADR:** [ADR-0061](../../decisions/ADR-0061-qfj-s1a-groq-staging-smoke-activation-enablement.md) §J.

## Test evidence

| Scope                                                            | Files | Tests |
| ---------------------------------------------------------------- | ----- | ----- |
| `@qf-jarvis/groq-staging-smoke`                                  | 6     | 174   |
| `@qf-jarvis/model-gateway` (incl. the 19 new QFJ-S1A gate tests) | 9     | 340   |
| Whole repository, unit suite                                     | 121   | 3564  |

All passing. Baseline on merged `main` was 115 files / 3390 tests after the gateway change, and
115 / 3371 before it — so S1A adds 6 test files and 174 tests without removing or weakening any.

Spec files:

- `credential-ingress.test.ts` — matrix items 6–14
- `config-traceability.test.ts` — matrix items 15–26
- `one-shot.test.ts` — matrix items 27–37
- `output-authority.test.ts` — matrix items 38–43
- `blocker-closure.test.ts` — matrix items 1–5
- `containment.test.ts` — matrix items 44–60
- `smoke-test-support.ts` — shared deterministic support (under `src/tests/`, excluded from `dist/`)

## No live network in tests or CI

- No spec contains `fetch(`.
- No spec **imports** `createFetchGroqTransport` — an unimported symbol cannot be called, so no spec can
  open a socket. (A spec may assert on the name as a string when proving the executable composes it.)
- No spec wires the real terminal into a run: `credentialSource: createNodeMaskedSecretSource` appears
  nowhere in any spec.
- Every run injects a deterministic transport (canned response, hanging, or immediately-failing) and a
  scripted terminal.
- No PostgreSQL test is added; the package has no integration suite and needs no database.

## Public API lock

The root barrel is locked at exactly **24** symbols, asserted key-for-key:

```
CREDENTIAL_PROMPT_LABEL      MAX_CREDENTIAL_LENGTH        MAX_SMOKE_TIMEOUT_MS
MIN_CREDENTIAL_LENGTH        MIN_SMOKE_TIMEOUT_MS         SMOKE_FAILURE_REASONS
SMOKE_PROMPT_FAMILY          SMOKE_PROMPT_VERSION         SMOKE_SCHEMA_REVISION
SMOKE_SUCCESS_REASON         SYNTHETIC_SMOKE_JSON_SCHEMA  SYNTHETIC_SMOKE_MESSAGES
createMaskedTtyCredentialResolver                         createNodeMaskedSecretSource
createSystemSmokeTimer       formatSanitizedPreRunFailure formatSanitizedSmokeResult
isSmokeReason                isSyntheticSmokeResponse     loadSmokeConfig
parseSmokeArgv               parseSmokeConfig             runGroqStagingSmokeOnce
runSmokeCli
```

The deterministic fakes never leak into it — every `./testing` export is asserted absent from the root,
and no exported name contains `chat`, `loop`, `session`, `repeat`, `retry`, `stream`, `send`, `deliver`,
`persist`, `store`, `activate`, `promote`, `rollout`, `register`, `core`, `n8n`, `whatsapp`, `approve`,
or `accept`.

The `@qf-jarvis/model-gateway` barrel is **extended, not broken**: no export is removed. The additive
change is the two new `GROQ_STAGING_BIND_REASONS` members and the new required fields on the existing
`GroqStagingRelease` / `GroqStagingBindEvent` types.

## dist containment

- `tsconfig.build.json` sets `"exclude": ["src/tests/**"]`, so no spec and no shared test support reaches
  `dist/`. Asserted, plus a walk of the emitted tree confirming no `/tests/` file and no `.test.` file.
- The obvious sentinel (`FAKE-STAGING-SENTINEL…`) is asserted absent from every emitted file **outside**
  `dist/testing/`, which is the deliberately-shipped `./testing` subpath.
- The repository's `pnpm check:dist-containment` script passes unchanged.
- `dist/` and `*.tsbuildinfo` remain git-ignored; nothing generated is committed.

## Dependency graph

- `@qf-jarvis/groq-staging-smoke` depends on exactly `@qf-jarvis/model-gateway` and `zod`.
- It exposes exactly `.` and `./testing`.
- **No workspace package depends on it** — asserted by scanning every `packages/*` and `apps/*` manifest.
  It is a leaf, so it cannot close a cycle.
- Production source imports none of `core-decision-adapter`, `jarvis-runtime`, `agent-runtime`,
  `event-backbone`, `event-ingestion`, `governed-knowledge`, `rag-provisioning`, `model-evaluation`, or
  `model-reply-adapter`.
- No new external dependency: `zod@4.4.3` is already pinned repo-wide, so the lockfile change is only
  the new workspace importer. The supply-chain policy check passes (180 entries).

## Source scans over production files

| Scan                                                                                                                               | Result                                       |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `fetch(` / `XMLHttpRequest`                                                                                                        | absent                                       |
| `node:net`/`http`/`http2`/`https`/`dns`/`tls`/`dgram`/`child_process`/`worker_threads`                                             | absent                                       |
| `pg`, `groq-sdk`, `openai`, `axios`, `undici`, `node-fetch`, WhatsApp libs, `n8n`                                                  | absent                                       |
| `process.env` / `import.meta.env` / `dotenv`                                                                                       | absent                                       |
| file writes (`writeFile*`, `appendFile*`, `createWriteStream`, `mkdir*`, `rm*`)                                                    | absent                                       |
| `node:fs` importers                                                                                                                | exactly one — `config.ts`, read-only         |
| SQL (`CREATE TABLE`/`ALTER TABLE`/`INSERT INTO`/`SELECT … FROM`), the word `migration`, any `.sql` asset                           | absent                                       |
| `embedding`, `vector`, `retrieval-augmented`, `pgvector`, `kimi`                                                                   | absent                                       |
| NUL/control byte                                                                                                                   | absent                                       |
| `Atomics.wait`, `execSync`, `spawnSync`, `deasync` (ADR-0058 §5)                                                                   | absent                                       |
| `createModelGateway`, `HybridRoutingPolicy`, `createProviderRolloutController`, `implements ModelProvider`, `class *ModelProvider` | absent — no second router, no second adapter |

## Repository invariants

- Migrations `0001`–`0007` byte-exact by SHA-256; **no `0008`**; no migration executed; no database
  contacted.
- `@qf-jarvis/event-backbone` root API lock remains **39**; no event-backbone file is touched.
- The fixed Groq endpoint is unchanged: `https://api.groq.com/openai/v1/chat/completions`, with
  `redirect: 'error'` and the non-official-endpoint refusal intact.
- The protected `docs/reports/qfj-managed-reconciliation-0002-0005/` directory is untouched: still
  present locally, still **untracked** (it is the only entry in `git status`, before and after), still
  one file. Because it is untracked it is absent from a fresh CI checkout by design, so the test asserts
  the invariant that actually holds in both places — this slice never commits it, and where it exists its
  single file is unchanged — plus that this slice's own reports live in their own directory.

## Local gate sequence (the same one CI runs)

| Step                                                   | Result                                      |
| ------------------------------------------------------ | ------------------------------------------- |
| `pnpm format:check`                                    | pass — all matched files use Prettier style |
| `pnpm lint` (`--max-warnings=0`)                       | pass — zero errors, zero warnings           |
| `pnpm typecheck` (+ every package's `typecheck:tests`) | pass                                        |
| `pnpm test:unit`                                       | pass — 121 files / 3564 tests               |
| `pnpm build`                                           | pass — SQL assets copied for 14 packages    |
| `pnpm check:dist-containment`                          | pass                                        |

`pnpm test:integration` requires a live PostgreSQL and is **deliberately not run locally** — this task is
not authorized for database access. CI runs it against its own ephemeral, disposable service container,
which touches no managed database and no production secret.
