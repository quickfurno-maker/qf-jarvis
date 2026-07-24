# Report 05 — Workstation Activation Prerequisites and Non-Goals

**Slice:** QFJ-P04.01C — Local OpenAI-Compatible Adapter. **ADR:** [ADR-0047](../../decisions/ADR-0047-qfj-p04-01c-local-openai-compatible-adapter.md).

## Activation prerequisites (all separately owner-authorized, none done here)

This slice ships the adapter code only. Bringing a real local workstation online later requires, at composition time:

1. **A running OpenAI-compatible server** on the private workstation/GPU node (Ollama, vLLM, llama.cpp, LocalAI, or equivalent), installed and operated **outside** this repository. This slice installs nothing and downloads no weights.
2. **A validated private endpoint** — a `LocalEndpointDescriptor` from `createLocalEndpoint(...)` for a private IP literal (loopback / RFC1918 / `100.64.0.0/10` / IPv6 loopback+ULA, or link-local with `allowLinkLocal`). HTTPS is preferred for non-loopback; plain HTTP to a non-loopback address needs `allowPlainHttpNonLoopback` (an attested private network).
3. **A model/capability declaration** — injected model id/version, context/completion bounds, and the declared structured-output modes (strict `json_schema` and/or `json_object`), evaluation-approved (QFJ-P04.04). No model default is hard-coded; no `/models` discovery occurs.
4. **An optional bearer token** via `createLocalAuthToken(...)` if the server requires one (injected, redacting). Loopback dev may use none.
5. **Three positive attestations** — `endpointAttested`, `modelAttested`, `authPostureAttested` — or `health()` reports unavailable and the router excludes the provider. The adapter cannot silently self-enable.
6. **A gateway mode flip** to `ACTIVE` and inclusion of the provider in the policy array. Hybrid failover policy (QFJ-P04.01D) is a separate, separately-governed slice.

## Non-goals — confirmed absent

This slice did **not**, and this report asserts it did not:

- make any live local-model call, any external request, or any LAN request; install or configure Ollama/llama.cpp/vLLM/LocalAI or any model server; download model weights; or use a real token.
- activate the local provider (or Groq) in production; deploy anything.
- add any agent runtime, Riya/Anisha prompt logic, memory, RAG, model tool-calls, MCP, web search, code execution, built-in provider tools, or n8n.
- add GPU orchestration, load balancing, a multi-node scheduler, or voice/audio/vision.
- touch any database, schema, or migration; reserve or add **migration 0008**; or access a managed database.
- introduce `process.env`, a secret loader, a hard-coded model default, `/models` discovery, streaming, the Responses API, tools/functions, or chain-of-thought/reasoning output.
- permit an arbitrary public endpoint, a hostname (by default), a redirect, embedded credentials, a query/fragment, or an arbitrary path.
- change the event-backbone root API (remains **39**), migrations 0001–0007, the Groq adapter, or the protected `docs/reports/qfj-managed-reconciliation-0002-0005/` directory.

## Standing boundary — reaffirmed

Riya is client-only, Anisha vendor-only, Jarvis the central coordinator, QuickFurno Core the final business authority, n8n execution-only. Kimi is excluded unless the owner reintroduces it. Model providers perform bounded inference only and authorize/execute nothing; the gateway (not n8n, not an agent) selects providers.

## Readiness

QFJ-P04.01C is **implementation-complete on a DRAFT PR, not merged, not production-active**. The next steps are: owner review, a separately authorized guarded merge (expected-head guard, normal merge commit), and — only when the owner stands up a private server, supplies the endpoint/model/token/attestations, and flips the gateway mode — production activation. The natural next slice is **QFJ-P04.01D (Hybrid Routing and Failover)**, which governs the cross-provider fallback policy the gateway already structurally supports.
