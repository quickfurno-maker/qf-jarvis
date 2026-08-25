# ADR-0115 - JAO-1 Mastra shadow operations supervisor proof

**Status:** Accepted - offline/shadow implementation only. No production activation, route, scheduler, persistence, migration, database access, provider credential, live model call, Core call, n8n execution, channel action, deployment, or business effect is introduced.
**Deciders:** Owner
**Owned by:** QFJ-P12 / JAO-1 - Jarvis Operations Supervisor, Shadow MVP
**Supersedes for this implementation only:** the older uploaded P05.04 phase label for the Mastra shadow supervisor. Its technical safety requirements are retained; ADR-0114 is the canonical roadmap ownership decision.

## Context

Baseline: `main` at `28e5c8b49975565b05d9efe026e60ccf43167164`, the certified merge of JAO-0 / PR #156.

JAO-0 established the framework-neutral Jarvis Autonomy & Operations overlay under QFJ-P12 and selected Mastra as the first supervisor/workflow harness behind QF authority boundaries. JAO-1 now needs the smallest executable proof that Mastra can orchestrate a bounded operational investigation without becoming a second Jarvis, model router, approval authority, business authority, or execution path.

Repository truth already supplies the two critical seams:

- `@qf-jarvis/control-plane-read-contract` exposes the single read-snapshot parser `parseControlPlaneSnapshotV1`; its snapshot carries no authority.
- `@qf-jarvis/model-gateway` exposes the provider-neutral `ModelGateway.invoke` waist with privacy/data-class policy, budgets, capability checks, routing, cancellation, provenance, and bounded provider behaviour.

An earlier revision of this slice placed JAO-1 under `apps/api/src/shadow/`. That was the wrong home
and the repository said so: `apps/api/src/shadow/` belongs to an older controlled model-shadow slice
whose containment specs deliberately forbid workflow, tool and activation vocabulary there, and adding
Mastra plus a control-plane dependency to `apps/api` also broke that app's exact credential-containment
dependency allowlist.

Both failures were architectural signals rather than obstacles, so JAO-1 moved rather than the tests.
`apps/api` returns to its certified baseline: its `package.json`, `tsconfig.build.json`,
`src/index.ts` and its credential-, shadow- and deployment-containment specs are unchanged by this
slice and pass as they stand.

## Dependency and supply-chain gate

JAO-1 exact-pins **`@mastra/core@1.61.0`** in `apps/worker` only. No other workspace declares a Mastra dependency.

At implementation time the preflight must verify from npm metadata:

- exact version `1.61.0`;
- license `Apache-2.0`;
- Node engine compatible with the repository's Node 24.18+ baseline;
- npm `dist.integrity` is present;
- no `easy-day-js` dependency;
- no install/preinstall/postinstall lifecycle script on `@mastra/core`.

This is load-bearing because Mastra disclosed a June 2026 npm supply-chain compromise that included `@mastra/core@1.42.1`. JAO-1 must never resolve or accept that compromised version, a floating `latest`, or an unpinned core dependency.

Verified on the implemented branch: the lockfile resolves `@mastra/core@1.61.0` with an `integrity`
hash and `engines: node >=22.13.0`; the installed manifest reports `Apache-2.0`; and `easy-day-js`
appears nowhere in `pnpm-lock.yaml`.

Stated honestly, because a pin is not the whole supply chain: `@mastra/core` itself pulls a broad
transitive tree that includes an MCP server package, a scheduler, a process-execution helper, a
WebSocket client and a product-analytics client. JAO-1 imports none of them, and a probe confirms that
importing `@mastra/core/workflows` does not load them; but the tree is present in `node_modules` and
that is a standing supply-chain surface a later JAO slice should evaluate rather than inherit
silently.

Only `@mastra/core/workflows` is imported. No Mastra provider, memory, storage, MCP, sandbox, browser, dynamic-workflow, scheduling, observability service, enterprise (`ee/`), or deployment package is adopted.

## Decision

### 1. Framework-specific code lives at the app shadow boundary

All JAO-1 framework-specific code lives under:

`apps/worker/src/jao/mastra-supervisor/`

No reusable trusted-kernel package imports Mastra. No new shared package is created.

The worker process entry and worker-entry composition remain unchanged and do not import or start the JAO-1 supervisor.

### 2. The first workflow is exactly one bounded operational-health investigation

Input is one explicitly injected unknown snapshot payload plus a caller-supplied bounded run id.

The first workflow:

1. parses the payload with `parseControlPlaneSnapshotV1`;
2. invokes exactly one local read-only capability over that already-validated snapshot;
3. detects only `DEGRADED` or `OFFLINE` system-component health as the JAO-1 anomaly class;
4. when an anomaly exists, performs at most one reasoning call through an injected QF Model Gateway bridge;
5. returns one bounded founder-facing **shadow operational attention** object;
6. stops.

A healthy snapshot performs one read and zero model calls.

A malformed snapshot performs zero reads and zero model calls.

### 3. The capability is L1 read-only and structurally powerless

The only capability is:

`read.system-health-from-snapshot`

Its descriptor is closed and fixes:

- actor: Jarvis;
- autonomy ceiling: `L1_READ`;
- max calls per run: 1;
- read-only: true;
- business effect: false;
- human approval required for the read: false;
- Core authorization required for the read: false;
- timeout declaration: 1000 ms.

It accepts only a `ControlPlaneSnapshotV1` returned by the existing parser and returns a strict, bounded health projection plus evidence references.

Capability output is revalidated as untrusted evidence before the workflow uses it. Extra fields are refused.

There is no generic `Record<string, unknown>` tool payload, arbitrary URL, SQL, shell command, path, credential, or action method.

### 4. QF Model Gateway remains the sole model authority

The Mastra workflow contains no model/provider definition.

The JAO bridge constructs one provider-neutral QF `ModelRequest` and calls an injected `ModelGateway` exactly once. It carries no provider id, model id, key, URL, fallback choice, retry loop, or provider SDK.

The request asks only for:

- `COORDINATION` / Jarvis scope;
- `HOSTED_ALLOWED` data class for this synthetic offline proof;
- structured output;
- cancellation support;
- bounded context/completion/cost/timeout;
- retry budget zero outside whatever the governed gateway itself may do.

The bridge validates the returned structured result again and refuses model-invented evidence references.

It also validates the returned PROVENANCE, and that check is a governance boundary rather than a
formality. The shared `ModelRunProvenance.mode` legitimately spans `OFF`, `SHADOW`, `CANARY`, `ACTIVE`
and `FALLBACK`, and it must keep spanning them -- JAO-1 does not get to narrow a type other slices
depend on. What JAO-1 decides is which of those modes it will ACCEPT, and the answer is exactly one:
its local provenance contract pins `mode` to the literal `SHADOW`, the bridge parses the gateway's
provenance through that strict schema, and anything else fails closed as an invalid model result.

A run that came back `ACTIVE` or `FALLBACK` would be a live production inference wearing a shadow
proof's receipt, so no provenance survives a refusal and none can be recorded as shadow evidence. The
first implementation declared the `SHADOW` literal in the contract and then handed the broad gateway
value straight through; the compiler refused it, and the refusal was correct -- the lock had been
written down but never enforced.

Gateway refusal/unavailability is a bounded JAO refusal. No independent retry or direct-provider fallback exists.

### 5. Prompt/tool injection cannot expand authority

Snapshot detail text, capability output, and model output are untrusted.

The system prompt explicitly treats evidence text as data. More importantly, authority is structural:

- the only registered capability is fixed before model invocation;
- model output schema contains no capability/tool/autonomy/action/authorization fields;
- strict validation rejects extra fields;
- the workflow never reads an instruction from model output to decide what capability exists;
- autonomy is the literal `L1_READ` in the run result.

A tool/model string such as "ignore policy and send WhatsApp" can therefore become only rejected or inert text; it cannot create a send path.

### 6. The founder-facing output is attention, not a second business recommendation runtime

JAO-1 returns an app-local `SHADOW_OPERATIONAL_ATTENTION` record containing diagnosis context, severity, one recommended human review step, confidence, and evidence refs.

It deliberately does **not** create a `RecommendationV1`, `ApprovalRequestV1`, communication authorization, execution intent, or proposed business action.

The existing recommendation runtime remains the canonical producer when JAO-6 later creates governed business-action proposals. JAO-1 is operational attention only.

### 7. Hard bounds and telemetry

Per run:

- max read capability calls: 1;
- max Model Gateway calls: 1;
- max specialists: 0;
- no recursion or agent spawning;
- no independent retry;
- no persistence;
- no background execution.

Cancellation is accepted as an injected `AbortSignal` and passed through to QF Model Gateway.

An injected clock supplies bounded duration accounting.

An optional injected telemetry hook receives only run id, trigger/task class, autonomy level, capability ids, model provider/model/version provenance, evidence refs, call counters, duration, outcome, and bounded refusal reason. It receives no API key, auth header, raw secret, or chain-of-thought.

### 8. Mastra is default-off and removable

No existing route, transport, runtime entry, schedule, API root, worker entry, or worker-entry composition imports the supervisor.

If `@mastra/core` or this composition is removed, existing Jarvis/Riya/Aarohi/Anisha behaviour remains unchanged. The slice has one consumer and therefore creates no shared package.

## Rejected alternatives

**Mastra agent configured with Groq/OpenAI/Anthropic directly.** Rejected. It would create a second production model authority.

**Mastra native memory/storage.** Rejected for JAO-1. Operational memory belongs to JAO-3 after the shadow proof.

**Dynamic workflows/schedules/ambient agents.** Rejected for JAO-1. They belong to later JAO stages.

**Full Capability Broker package.** Rejected. One consumer does not justify a shared package.

**RecommendationV1 for the shadow health notice.** Rejected. The first proof creates no business action and should not invent a business subject/risk/approval meaning merely to fit the recommendation contract.

**Specialist delegation.** Rejected for this proof. JAO-2 owns it.

## Security and mutation proof

The test suite must prove:

- only `@mastra/core/workflows` is imported from the Mastra scope;
- no trusted-kernel package imports Mastra;
- app package root does not import/activate the supervisor;
- malformed snapshots fail before capability/model use;
- malformed capability output fails before model use;
- capability failure is normalized;
- gateway failure is normalized and called at most once;
- model output cannot add capabilities/authority;
- injection-shaped snapshot text cannot raise autonomy or create a send capability;
- provider/model/credential selection is absent from the request;
- cancellation fails closed;
- descriptor/budget constants remain read-only/no-effect.

Before commit, two temporary source mutations are run and must make focused JAO-1 tests fail:

1. mutate the capability descriptor from `businessEffect: false` to `true`;
2. mutate the QF gateway call site away from `gateway.invoke`.

Both mutations are restored byte-for-byte, and the focused test is re-run green.

## No migration / no execution

`NO_MIGRATION=YES`
`NO_NEW_DB_TABLE=YES`
`NO_MASTRA_STORAGE=YES`
`GROQ_CALLS=0`
`LOCAL_MODEL_CALLS=0`
`REAL_CREDENTIAL_READS=0`
`LIVE_CORE_CALLS=0`
`LIVE_N8N_EXECUTED=NO`
`LIVE_WHATSAPP_EXECUTED=NO`
`LIVE_META_EXECUTED=NO`
`PRODUCTION_DEPLOYMENT=NO`

## Change-control rule

JAO-1 remains shadow/default-off after merge. Any live operational adapter, persistent memory, specialist delegation, sandbox, ambient scheduling, business-action proposal, real provider call, route, deployment, or autonomy-level expansion requires its owning later JAO slice and separate review.
