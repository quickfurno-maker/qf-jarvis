# QFJ-S2-E-B — Offline Controlled SHADOW One-Shot Runner

**Phase:** S2-E-B · **Branch:** `s2e-b-controlled-shadow-runner` · **Baseline:** `d87901104f1a6be9f0bd3e184a3cac7a687bd172`
**Decision record:** [ADR-0065](../decisions/ADR-0065-controlled-shadow-validation-at-the-process-boundary.md)

This phase builds the machinery for one controlled live SHADOW validation and **does not run it**. No real credential was accessed, no provider was contacted, no network request was made, no provider is production-active, and nothing was deployed. Running it live requires a separate, fresh, single-use owner authorisation (S2-E-C).

---

## 1. The actual SHADOW semantics — reused, not reinvented

S2-E-A established that `packages/model-gateway` already implements SHADOW, and this phase reuses it exactly rather than building a candidate-only probe. The behaviour the runner is written against:

| Behaviour                                                                                       | Consequence for the runner                                                                         |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| The **stable** provider serves first and its response is returned                               | The runner receives a real `ModelResponse` and must dispose of it                                  |
| The **candidate** runs afterwards, sequentially, and its output is discarded inside `runShadow` | The runner cannot read candidate output even if it wanted to                                       |
| Candidate failure is **non-fatal to the gateway**                                               | The gateway returns stable success regardless; the runner must observe the candidate independently |
| SHADOW performs exactly one stable and one candidate attempt                                    | `maxShadowAttempts=1`, no retry                                                                    |
| The candidate invocation bypasses the serving `AttemptLedger`                                   | `provenance.attempts` **does not count** the shadow call                                           |
| Candidate latency delays completion because `runShadow` is awaited                              | The hard deadline must accommodate two sequential calls                                            |
| The serving-boundary evidence gate runs before health, selection and invocation                 | A refusal happens before any provider execution                                                    |
| Groq `health()` is local                                                                        | Two health checks cost no network request                                                          |

**Why both legs are real-shaped.** A probe that called only the candidate would prove the candidate answers, not that the SHADOW _path_ works. The value of this run is the path: the rollout policy, the evidence gate, the provider selection, the ledger, the shadow dispatch and the disposal. Testing anything less would leave the first real SHADOW promotion unvalidated.

**Why candidate failure is a runner FAIL.** The gateway's contract is correct — a shadow must never break serving. But the _purpose_ of this run is to learn whether the candidate is viable, so silence on candidate failure would turn a failed validation into a green light. The runner therefore inverts the polarity at its own boundary: `stable success AND candidate shadow completion` or `FAIL`. It does **not** retry, and it does **not** hide the failure behind the stable response.

---

## 2. The internal evidence-registry subpath

The evidence registry lived inside `model-gateway-composition` with no way for `apps/api` to reach it (root API = 2). Two options were rejected:

- **Adding it to the root API** — the composition root is locked at 2, and the registry would become a general extension surface.
- **Re-implementing it in `apps/api`** — duplicating the target ladder and the verifier is exactly how two gates drift apart.

The chosen route is one explicit subpath, following the existing `event-backbone` `./internal/*` precedent:

```
@qf-jarvis/model-gateway-composition/internal/evidence-registry
```

| Lock                                          | Value                                                                   |
| --------------------------------------------- | ----------------------------------------------------------------------- |
| Root runtime exports                          | **2** — `createProductionModelGateway`, `createLiveModelGatewayInvoker` |
| Internal subpath runtime exports              | **1** — `createEvaluationEvidenceRegistry`                              |
| Registry / ladder / verifier logic duplicated | none                                                                    |
| New dependency                                | none                                                                    |
| Export targets                                | `./dist/**` only                                                        |

No `model-gateway` production code changed. The subpath is documented as process-boundary-only, and both the composition's own API spec and the `apps/api` containment spec assert the two counts.

---

## 3. Two Groq providers, one credential

The first live run needs a stable leg and a candidate leg. It does **not** need two secrets.

```
resolver.resolve()  ──── exactly once ────►  one immutable GroqApiKey
                                                    │
                        ┌───────────────────────────┴───────────────────────────┐
                        ▼                                                       ▼
          stable provider config                                candidate provider config
          providerId   groq.<stable>        distinct            providerId   groq.<candidate>
          releaseId    rel.<stable>         distinct            releaseId    rel.<candidate>
          configDigest <stable>             distinct            configDigest <candidate>
          modelId / modelVersion            SHARED              modelId / modelVersion
          capabilityProfileRef              SHARED              capabilityProfileRef
          dataControlsAttestationRef        SHARED              dataControlsAttestationRef
```

One credential reference, one file read, one resolve, zero refreshes. Distinct identities are **required** by validation — identical provider IDs, release IDs or config digests are refused with `config-identity-not-distinct`, because a shadow comparing a release against itself proves nothing. The shared `modelId`/`modelVersion` is what makes this a _path_ validation rather than a model comparison.

**The model stays configuration-driven.** No production source names a live model. `gpt-oss`, `llama-3`, `mixtral`, `groq.com` and `api.groq` are all asserted absent from production source. The model identity arrives in the non-secret run configuration, and the exact value remains an S2-E-C owner decision. Hard-coding it here would bake a vendor catalogue entry into a governance boundary and make the runner obsolete the moment the model is retired.

---

## 4. Least authority: `SHADOW_ELIGIBILITY` exactly

The evidence target must be **exactly** `SHADOW_ELIGIBILITY`. A higher-authority target is refused even though it would logically permit SHADOW:

| Target                                    | Verdict                                                |
| ----------------------------------------- | ------------------------------------------------------ |
| `SHADOW_ELIGIBILITY`                      | accepted                                               |
| `CONNECTIVITY_SMOKE`                      | refused — insufficient                                 |
| `SEMANTIC_RETRIEVAL_RESEARCH_ELIGIBILITY` | refused — wrong axis                                   |
| `CANARY_ELIGIBILITY`                      | refused — **more** authority than this run may consume |
| `ACTIVE_MODEL_RELEASE`                    | refused — **more** authority than this run may consume |

Accepting a broader approval would let a future CANARY approval silently authorise a SHADOW run that was never reviewed as a SHADOW. The refusal happens **before the credential is read** — the spec asserts `credentialReads === 0` on every refused target.

The evidence for this phase is `synthetic=true`, `productionApproval=false`.

---

## 5. The offline evidence generator

`ApprovalEvidence` is never hand-written. The generator drives the real `@qf-jarvis/model-evaluation` factories — `createEvaluationScenario`, `createEvaluationSuite`, `createSuiteThresholds`, `createCandidateObservation`, `evaluateSuite`, `createEvaluationBinding`, `createApprovalEvidence` — so the evidence exists only because the real gates passed.

It covers the **full** `DEFAULT_MANDATORY_RED_TEAM_KINDS` set (17 kinds), each `CRITICAL`, each requiring refusal and a valid structured output. This matters: `mandatoryRedTeamKinds` defaults to `[]`, so an empty suite would satisfy `mandatoryCovered` trivially. Declaring an empty mandatory set would have been a way to _game_ the gate rather than pass it.

Generation is byte-stable (a fixed `createdAt`), so the digest is deterministic and an operator can pin it. A hand-edited artifact no longer matches — asserted directly. The generator touches no credential, constructs no provider, and makes no network call.

Its output line carries only `timestamp`, `outcome`, `reason`, `evidenceTarget`, `evidenceDigest`, `synthetic`, `productionApproval`, `authority`. No path, no credential reference, no config digest, no prompt. The artifact goes to a separate sink so the two never mix.

**No live operational evidence or config artifact is committed.**

---

## 6. The process-local composition

`createProductionModelGateway` is **unchanged** and still refuses every non-OFF mode — asserted for `SHADOW`, `CANARY` and `ACTIVE`. The runner does not call it at all; the containment spec asserts neither `createProductionModelGateway` nor `createLiveModelGatewayInvoker` appears anywhere in `src/shadow/`, `src/cli/` or `src/bin/`.

Instead the runner composes its own gateway via `createModelGateway`, with a rollout controller it constructs, owns, and never returns. The full sequence:

1. load and validate the non-secret config
2. load the evidence and confirm its shape
3. recompute both digests and compare them to the CLI claims
4. build the frozen evidence registry through the internal subpath
5. take the verifier from it
6. construct the file credential binding **without reading**
7. resolve the credential **exactly once**
8. build two provider configs, then two provider instances
9. register stable and candidate
10. build the capability registry and policies from existing contracts
11. create the rollout controller at **OFF, revision 0**
12. `createModelGateway` with `retryBudget=0`, fallback disabled, the verifier, the controller and the hard counters
13. transition **OFF → SHADOW, revision 1** using verified evidence
14. invoke **one** fixed synthetic request
15. classify the stable outcome, then require candidate shadow completion
16. drop the stable response body
17. in `finally`: clear the deadline timer, `emergencyDisable`, prove **OFF, revision 2**
18. emit one safe JSON line

Nothing internal escapes: the result's key set is asserted to be exactly `SHADOW_RESULT_KEYS`, and `gateway`, `controller`, `verifier`, `registry`, `provider(s)`, `transport`, `credential`, `request`, `response`, `evidence` and `config` are all asserted `undefined` on it. The result is frozen.

**One implementation note worth recording.** The first draft returned the result from inside `try`, which evaluated the frozen object _before_ `finally` recorded the final OFF state — every run would have reported `finalMode: 'UNKNOWN'`. The body is now an inner async closure with early `return;` statements, and the result is built after cleanup. Exactly one `return finish()` remains, at the end.

---

## 7. The fixed synthetic request

Fixed in source, unreachable from the CLI or the config:

- `promptId` = `qfj.s2e.synthetic.shadow.v1` — a config declaring any other value is refused
- one fixed system prompt and one fixed user prompt
- `shadowReplySchema` = a strict object whose only field is `status`, whose only value is `ok`
- `SHADOW_MAX_RESULT_CHARS` = 128
- `retryBudget` = 0, `resultMode` = `STRUCTURED`, `agentScope` = `SYSTEM`, `dataClass` = `HOSTED_ALLOWED`

The prompt contains no name, phone number, email, address, or customer/vendor/project information; it performs no memory lookup, requests no tool and no external action, and contains no prompt-injection content. Two requests differing only in run id and timeout produce byte-identical message arrays — asserted. The containment spec asserts no `promptText`, `systemPrompt:`, `userPrompt:` or `--prompt` surface exists.

Stable and candidate receive the **same** `ModelRequest` object: the gateway hands its single validated request to both legs, so identity holds by construction rather than by copying.

---

## 8. Output disposal

**Candidate output** never leaves `runShadow`. The provider wrapper sees the result but records only closed status, latency and token usage — never `textResult`, never `structuredResult`, never `output`.

**Stable output** reaches the runner as a `ModelResponse`. The runner records latency and token counts, drops the body reference, and never serialises, returns, logs, hashes or measures it. There is **no output digest and no output length** — asserted by key absence, because a digest is a fingerprint of content and a length is a side channel.

The proof is two unique sentinels — one embedded in the stable leg's output, one in the candidate's — asserted to appear **zero** times in the result object, its JSON line, and its concatenated values. The result line is additionally asserted free of the credential reference, every path, the config digest, the evidence digest, the evidence reference, the prompt id, the prompt text, `authorization` and `Bearer`.

`modelOutput` is the literal `DISCARDED`. Production source contains no `console.*`; only the final writer writes one line.

---

## 9. Runner-owned hard counters

`provenance.attempts` does not count the shadow call, so the runner counts for itself. Every counter has a ceiling and **refuses before exceeding it** rather than recording an overrun.

| Counter                      | Budget | Counter               | Budget |
| ---------------------------- | ------ | --------------------- | ------ |
| credential file reads        | 1      | stable invocations    | 1      |
| credential resolve attempts  | 1      | candidate invocations | 1      |
| credential resolve successes | 1      | transport requests    | 2      |
| refreshes                    | **0**  | retries               | **0**  |
| provider constructions       | 2      | fallbacks             | **0**  |
| health checks                | 2      | rollout transitions   | 2      |
| timers armed                 | 1      | timers cleared        | 1      |
| model outputs retained       | **0**  |                       |        |

A third provider invocation and a third transport request are refused **before delegation**. The wrappers do not log, retain prompts or responses, inspect `Authorization`, retain headers, or attach arbitrary errors. A PASS run is asserted to match this table exactly, including a physical read count of 1 from the injected reader.

---

## 10. The hard deadline

One `AbortController` and one timer.

```
hardDeadlineMs = min( (2 × timeoutMs) + 10_000 , 70_000 )
```

`timeoutMs` is supplied in the config and bounded to **1,000–30,000 ms**. Asserted: `1_000 → 12_000`, `5_000 → 20_000`, `29_000 → 68_000`, `30_000 → 70_000` (capped, not extrapolated).

The timer is armed exactly once and cleared exactly once — on success **and** on failure. A fired deadline aborts the run, produces the fixed reason `timeout`, causes no retry and no fallback, and still ends at `finalMode: 'OFF'`. No dangling timer, no automatic rerun. Exactly one production module arms a timer, and that is asserted by scan (one `setTimeout`, one `clearTimeout`, no `setInterval`).

---

## 11. `OFF → SHADOW → OFF`

| Point                               | Mode     | Revision |
| ----------------------------------- | -------- | -------- |
| construction                        | `OFF`    | 0        |
| after the one authorised transition | `SHADOW` | 1        |
| after the final `emergencyDisable`  | `OFF`    | 2        |

Asserted on the happy path and, separately, after a candidate failure — the `finally` block runs either way. If final OFF cannot be proven the reason is `final-off-not-proven`. **No provider is left active after the run.**

---

## 12. The result contract

One single-line JSON object with exactly the declared keys, emitted in a fixed order via `SHADOW_RESULT_KEYS`. The CLI re-projects onto that key list as defence in depth, so a runner that somehow returned more could not leak it.

> **Amended by QFJ-S2-E-C-R1.** The contract was 37 keys as shipped in this phase. It is now **38**: `candidateFailureClass` was added immediately after `reason` after the first live run showed that `provider-unavailable` folds four operationally opposite candidate failures into one string. See the [ADR-0065 amendment](../decisions/ADR-0065-controlled-shadow-validation-at-the-process-boundary.md#amendment--qfj-s2-e-c-r1-the-closed-candidate-failure-class). `reason` remains authoritative; the new field is a coarse closed class carrying no HTTP status, message, header, body or retryable flag.

Closed reasons — nothing finer is exposed at the CLI boundary:

`shadow-completed` · `config-invalid` · `evidence-refused` · `credential-unavailable` · `policy-refused` · `provider-unavailable` · `rate-limited` · `timeout` · `cancelled` · `provider-output-invalid` · `call-budget-exceeded` · `final-off-not-proven` · `internal-invariant`

Every failure is caught: an arbitrary `Error`, its `cause` and its stack are discarded. A pre-run refusal emits a blank closed result rather than a partial one.

---

## 13. The CLI

Five closed flags: `--config`, `--evidence`, `--credential-file`, `--expected-config-digest`, `--expected-evidence-digest`. Refusals: unknown flag, duplicate flag, missing value, relative path, malformed digest, unexpected positional, missing required.

No flag accepts a credential value, a prompt, a model output, an environment-variable name, a directory to scan, a second credential path, a fallback provider list, a retry count, a tool, a header or an endpoint. `argv` is never echoed.

Both digests are recomputed from the loaded artifacts and compared **before** the credential file is opened — a digest mismatch is asserted to refuse without reaching the runner, and its line is asserted free of the digest it rejected.

**Documented limitation.** The credential file path is a command-line argument and therefore visible in the operating-system process list. The application never prints it. The alternatives are worse: an environment variable is inherited by every child process, and a stdin prompt cannot be automated or audited. Using stdin as a workaround is explicitly not done.

---

## 14. File boundaries

`node:fs` is confined to exactly **two** designated adapters, asserted by scan:

| Adapter                                 | Reads                             | Ceiling                | Mode check           |
| --------------------------------------- | --------------------------------- | ---------------------- | -------------------- |
| `src/secrets/credential-file-reader.ts` | the credential only               | 514 bytes              | POSIX `mode & 0o077` |
| `src/shadow/shadow-json-reader.ts`      | non-secret config / evidence JSON | 16,384 / 262,144 bytes | none — non-secret    |

They are separate modules deliberately. Merging them would let a non-secret path inherit secret-file handling, or the reverse. Both are read-only: `open` in `'r'` mode plus `lstat`, with `writeFile`, `appendFile`, `unlink`, `rm`, `mkdir`, `rename`, `chmod`, `chown`, `copyFile`, `createWriteStream` and `truncate` all asserted absent. **The credential file's owner-only mode requirement is unchanged.**

Both readers reject a relative path, a directory and a symlink, bound the size before allocation, and discard the raw filesystem error. No path, `ENOENT`, or parser message appears in any result — asserted.

---

## 15. Containment

| Rule                                                                                          | How it is proven                                                                                                             |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| No `process.env` anywhere in `apps/api`                                                       | unconditional scan over every `.ts` file                                                                                     |
| Every other `process` access                                                                  | an exact allowlist of file → member, asserted **exhaustive in both directions** so a stale permission cannot linger          |
| No stream is **read**                                                                         | `process.stdin`, `prompt(`, `setRawMode`, `createInterface` absent                                                           |
| Only the two bins touch `argv`/`exitCode`                                                     | scan over all non-bin modules                                                                                                |
| Only the two default-IO factories touch a stream                                              | allowlist, write-only                                                                                                        |
| No network, shell or terminal module                                                          | `node:net/http/https/dns/tls/dgram/child_process/readline/repl/worker_threads/cluster`, `fetch(`, `exec*(`, `spawn*(` absent |
| No clipboard, keychain, cloud secret store, `dotenv`, vault, Docker, database or provider SDK | substring scan                                                                                                               |
| No watcher or polling loop, and nothing is logged                                             | `setInterval`, `setImmediate`, `watch*`, `console.*`, `pino/winston/bunyan/debug/log4js` absent                              |
| One timer module                                                                              | scan, with one arm and one clear                                                                                             |
| No tool, n8n, WhatsApp, webhook, workflow or database capability                              | substring scan                                                                                                               |
| No refresh, hot-rebind or dispose path                                                        | exact call-shape list; `close()` permitted only on a file handle in the JSON reader                                          |
| The composition is reached only through its declared entry points                             | no `dist/` or `src/` reach-around                                                                                            |
| No raw-secret fixture                                                                         | `gsk_…`, `sk-…`, `BEGIN … PRIVATE KEY` absent; any credential-length fake must announce `DO_NOT_USE`                         |
| No literal control byte                                                                       | numeric regex over every file                                                                                                |

**Two false positives were fixed honestly rather than by weakening the scan.** `DIRECT_BUSINESS_OR_N8N_EXECUTION` is a red-team case _kind_ the generator must enumerate to cover the mandatory set — it names behaviour the candidate must **refuse**, so the identifier is normalised away before the capability scan. And the zero-ceiling `refreshes` counter legitimately contains "refresh", so the refresh check is an exact call-shape list rather than a substring sweep. Both containment scanners are excluded from each other's scans, since a spec that names what it forbids would otherwise flag its own prohibition.

---

## 16. API, dependency and repository locks

| Lock                                         | Expected                     | Status                              |
| -------------------------------------------- | ---------------------------- | ----------------------------------- |
| `model-evaluation` root runtime API          | 33                           | unchanged                           |
| `model-gateway` root runtime API             | 71                           | unchanged                           |
| `model-gateway-composition` root runtime API | 2                            | unchanged                           |
| composition internal subpath runtime API     | 1                            | **new lock**                        |
| `groq-staging-smoke` root runtime API        | 24                           | unchanged                           |
| `event-backbone` root runtime API            | 39                           | unchanged                           |
| `apps/api` root runtime exports              | 0                            | unchanged                           |
| `model-gateway` dependencies                 | `["zod"]`                    | unchanged                           |
| `model-evaluation` dependencies              | `["zod"]`                    | unchanged                           |
| composition dependencies                     | the three workspace packages | unchanged                           |
| Migrations 0001–0007                         | byte-identical (SHA-256)     | unchanged                           |
| Migration 0008                               | absent                       | absent                              |
| New package or app                           | none                         | none — 13 packages, 2 apps asserted |
| Protected directory                          | untouched                    | reported from `git status` only     |

`apps/api` runtime dependencies are now `@qf-jarvis/model-evaluation`, `@qf-jarvis/model-gateway`, `@qf-jarvis/model-gateway-composition` (all `workspace:*`) and `zod@4.4.3`. `devDependencies` is gone — the composition was a test-only dependency under S2-D-B and is production source now.

**No new third-party dependency.** `zod` is already pinned by nine workspace packages at the same exact version; adding it to `apps/api` produced **0 new resolutions** in `pnpm-lock.yaml` (workspace links and an already-resolved `zod@4.4.3` only).

---

## 17. Tests and gates

258 tests across `apps/api` and `packages/model-gateway-composition` cover the eight required groups: the internal subpath, config and CLI parsing, evidence generation, file boundaries, runner lifecycle, the call budget, output disposal, the deadline, activation safety, and the API/dependency/repository invariants.

Every test is offline. Fake providers, fake transports, a synthetic credential (`FAKE_QFJ_CREDENTIAL_DO_NOT_USE_S2EB`), temporary synthetic files. No network, no real credential, no provider SDK, no database, no container. No testing-only provider enters the production executable dependency graph.

The seven gates were run in stop-on-first-failure order with `.mcp.json` parked outside the repository by rename — never opened, read, hashed, modified, deleted, gitignored or committed — and restored afterwards as the same filesystem object.

---

## 18. What did not happen

- no real credential was accessed, and the file resolver was never invoked against a real credential file
- the masked-TTY resolver was never invoked
- no environment value was read
- no clipboard, keychain or secret-store access
- no network or provider request; no Groq smoke; no `curl`, `Invoke-WebRequest`, `Test-NetConnection`, `nslookup`, `ping`, Postman, Playground or provider SDK call
- no database, Supabase or Docker access
- no migration, deployment or live activation
- no CANARY, ACTIVE or FALLBACK
- no provider activation, and **no provider is production-active**
- no automatic rerun
- no consumed authorisation was reused
- the protected reconciliation directory was reported from `git status` and nothing else

## 19. S2-E-C

Running the SHADOW validation against a real credential and a real provider requires a **fresh, single-use owner authorisation**. That phase must supply the exact model id and model version, generate the operational config and evidence artifacts, and pin both digests. Nothing in this phase schedules, triggers or repeats a live run.
