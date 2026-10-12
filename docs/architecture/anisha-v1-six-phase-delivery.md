# Anisha V1 — Six-Phase Delivery Plan (Reuse First)

**Created:** 2026-10-12 IST

**Status:** Approved direction for *internal development only*; no production WhatsApp activation or memory-policy changes.

**Namespace:** AN-A1 ... AN-A6. Independent from QuickFurno Vendor OS VO-01..VO-08, AGNI, or Jarvis historical phase numbers.

## Architectural authority

QuickFurno Core alone decides vendor identity, active/suspended state, consent, conversation actor, credits, packages, pricing, lead assignment and any execution. Jarvis/Anisha receives a fresh, signed, bounded Core turn material; Anisha advises or drafts responses and may propose human escalation but cannot alter credits, send messages directly, approve payments or exceed three assignments. Native Automation remains the execution system; Meta transports and reports outcomes. Role and erasure gates fail closed, with no fallback from Anisha to Riya or Aarohi.

**Existing components to reuse:** Core identity resolver + conversation outbox + signed turn material, Jarvis WhatsApp production worker and specialist runtime, Anisha behavior kernel and prompt registry, governed-memory foundation/postgres store, conversation context reader, Agent Flow Canvas, QuickFurno Automation Studio, AOS vendor-success bridge and AGNI owner supervision.

## AN-A1 — Identity, WhatsApp authorization and source-of-truth integrity
- Protect model invocation by an additional preflight that rejects actor/subject/party mismatches, absent canonical vendor subject reference, pause, human takeover, cancellation, erasure, non-hosted content, and Jarvis-disabled status. Core's fresh signed authority gate remains the final decision.
- Confirm exact Meta inbound -> Core identity lookup -> persisted vendor subject -> actor ANISHA -> Jarvis queue -> material -> proposal -> Core callback -> delivery outbox path. Verify conflicting sender, unknown, duplicate webhook, released vendor, revoked consent, wrong provider account and closed conversation behaviors in *staging*; no unapproved production send.
- Instrument provider-neutral reason codes and cross-system correlation without PII. No redesign of Core identity, WhatsApp service or durable worker.
- **Current change:** deterministic, read-only model preflight + regression test suite in feature branch. This is A1a, not complete A1 certification.
- **Exit:** linked vendor turns succeed; all wrong-role/privacy states are refused without LLM call; staging identity/router/callback round-trip with no unauthorized provider send.

## AN-A2 — Conversation continuity and privacy-governed memory
- Reuse Core bounded short-term per-conversation context (clearly marked NON_AUTHORITATIVE) and Jarvis governed-memory foundation. Treat Core vendor facts as authoritative and conversational history as *claims*, never wallet or lead truth.
- Design subject-scoped ownerAgent=ANISHA long-term memory records only for approved, necessary preferences and resolved support outcomes; require explicit policy, TTL, subject binding, opt-out, correction and erasure handling. Durable memory stays disabled until separate owner/governance approval.
- Avoid recording phone numbers, payment instruments, vendor contact exports, raw conversation dumps or model reasoning in AGNI/telemetry. Re-read Core after human takeover and resume, and ensure stale memory never overrides Core.
- **Exit:** multi-turn continuity, isolated vendor histories, invalidation/erasure and cross-vendor leakage tests; zero unauthorized durable writes and no backward leakage across actor handoffs.

## AN-A3 — Live vendor Core context, safe knowledge and cost-aware answers
- Integrate current onboarding blocker, verification, office location, city/category, package/expiry/credit bands, lead status and support ticket status from signed Core projections (minimum needed by intent). No duplicated vendor CRM truth.
- Couple agent knowledge to versioned QuickFurno catalog/service policies; fail safely on stale knowledge or missing facts. Provide reliable English, Hindi and Hinglish, suggest human help for uncertain eligibility/finance/complaints.
- Prefer deterministic FAQ templates and low-cost model for ordinary questions; escalate to stronger models only for genuinely complex cases with hard budgets and traces.
- **Exit:** grounded answers across 30+ multi-turn vendor scenarios; budget guard + missing context drill; no factual balance/price claims from untrusted memory.

## AN-A4 — Vendor success, service requests and human handoff
- Deliver onboarding guidance, lead response coaching (not per-lead accept/reject), basic troubleshooting, low-credit and package explanations, complaint intake and escalation. Persist cases/tasks in existing Core CRM/support infrastructure when justified, never direct provider sends.
- Core approves status-changing actions, adjustments, refunds, etc.; Anisha's role is explanation and bounded proposal.
- Recover from interrupted turns, duplicate inbound, missing Meta receipts, 24-hour service window expiry, human takeover and AI resume without duplicate action.
- **Exit:** complete staging vendor-to-human escalation and resolution, idempotent tasks and clean conversation ownership; all sends proved with provider receipts or visibly UNKNOWN.

## AN-A5 — Automation Workshop + AOS proactive vendor intelligence
- Use existing QuickFurno Studio five producible vendor actions, not a new engine; map registered low-credit, expiry, onboarding, response reminder and lead-offer action triggers to Core facts.
- AOS detects vendor opportunity/inactivity/satisfaction with evidentiary confidence, proposes responsible next-best-support; Core validates and Native Automation executes only authorized communication.
- Add Jarvis Agent Flow Canvas nodes for Anisha role guard, Core material, conversation context/memory read decision, intent, proposal, Core decision, outbox, provider callback; link to Automation Studio/AGNI via correlation ID. Label real traces distinct from editable diagrams.
- **Exit:** advisory -> Core authorization -> native job -> external-safe staging send/receipt -> measured vendor outcome; zero unauthorized AI-led sends.

## AN-A6 — End-to-end certification and controlled production activation
- Run deterministic staging journey from identity registration through approved WhatsApp conversation, support, follow-up, recharge assistance, complaint and opt-out. Include adversarial identity, stale memory, unauthorized actor, model outage, replay, webhook loss, telemetry loss, queue crash, consent revocation and financial authority boundaries.
- Validate current VPS revisions, feature switches, signed release, worker lanes, CI, secrets, rollback and kill switch. Configure external Meta templates/test number and any live provider account last.
- Start only with opted-in canaries; measure latency, unit cost, response correctness, provider accepted/sent/delivered distinction, support outcomes and unhandled incidents; owner sign-off before general activation.
- **Exit:** complete vendor lifecycle with traceable evidence and no leaked data, unauthorized sends or financial changes. None of these gates is satisfied merely because a source module exists.

## Parallel tracks and phase evidence
AN-A1 → AN-A2+AN-A3 in parallel → AN-A4 → AN-A5 → AN-A6. Early read-only event design in AN-A1; provider calibration and dynamic autonomy only after certified Core authority.

Every increment records exact feature/base SHA, tests, staged observations, privacy/security consequences, rollback, production gap and Notion update. Use internal provider mocks for engineering; leave actual WhatsApp production activation for AN-A6.

## AN-A1a evidence, 2026-10-12
- Existing main: qf-jarvis 0ca4af72978a0bc49dd55ff1d187b7358e0b40b6.
- Change: `anisha-vendor-preflight.ts` pure guard, specialist runtime early defense-in-depth and detailed positive/negative tests.
- Focused suite: 61/61 PASS (Anisha preflight, specialist runtime and WhatsApp turn processor).
- TypeScript: `tsc --noEmit --project apps/api/tsconfig.json` PASS.
- No Core or production mutation; no live Meta send and no durable memory enabled.
- **Not yet certified:** complete signed Core-to-Jarvis staging webhook/callback, real provider receipt, memory retention/erasure policy, production release.
