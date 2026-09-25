- **Status:** Accepted
- **Date:** 2026-09-25
- **Owners:** QF Jarvis
- **Scope:** Proactive Jarvis intelligence, Jarvis OS, event correlation, future mobile and voice clients

## Context

Jarvis already has governed events, agent provenance, model intelligence, semantic context, digital-twin simulation, controlled ambient monitoring and an operator control plane. The remaining product gap is not another independent subsystem: those capabilities must be composed into a proactive operating layer that tells the operator what changed, what is wrong, what needs human attention and which safe recovery posture is available.

Static capability declarations are insufficient once live observation and command bridges exist. A declared NOT_CONNECTED state can become stale after a signed runtime adapter is connected, while a compiled-in AVAILABLE claim can become false when a dependency degrades. The operator needs declared state and effective runtime state separately.

Exact “why did this happen?” replay also requires correlation evidence. The canonical event envelope already carries correlationId across source events, recommendations, approvals, execution and closure, but the generic projection contract deliberately hides correlation and subject identity from every projection. Widening that generic contract would weaken an existing privacy boundary.

## Decision

Jarvis gains a pure @qf-jarvis/proactive-intelligence package. It may:

- prioritize bounded operator attention from P0 through P3;
- detect deterministic relative-metric anomalies;
- assess model/cache/token/cost/latency efficiency;
- recommend safe recovery posture, including certified fallback or bounded retry;
- evaluate continuous quality evidence and recommend HOLD where evidence is stale, insufficient or regressed; and
- resolve effective capability state from runtime observation, command-authority connectivity and the governed declaration.

Every proactive result carries no business authority. The package has no scheduler, provider client, Core client, database, network, environment read, credential, execution transport or rollout mutation. Recovery recommendations explicitly state that execution is not authorized.

Jarvis OS renders a Jarvis · Now brief from the governed control-plane snapshot. It ranks what needs attention but only deep-links to reviewed operating surfaces. Existing operator commands remain the only mutation seam, and QuickFurno Core remains authoritative.

Capability surfaces show both the governed declaration and the effective observed state. Runtime evidence may correct stale presentation state, but never grants authority.

## Correlation decision

The event backbone adds a disposable correlation-timeline projection. It stores only:

- the canonical correlation UUID;
- the gap-free projection position;
- event type and version; and
- event acceptance time.

It stores no payload, subject, event id, causation id, provider detail, prompt, model output, free text or business value.

Correlation identity is read through a dedicated narrow internal reader used only by the correlation-timeline reducer. The generic ProjectionEvent remains metadata-only and correlation-blind. This preserves the existing least-privilege projection model while making an ordered lineage read model possible.

Until correlation coverage is actually exposed through the operator snapshot, Jarvis OS must report decision-trace coverage as unknown rather than infer completeness.

## Proactive behavior boundary

“Proactive” means Jarvis may continuously observe, detect, rank, explain, simulate and recommend within reviewed monitoring budgets. It does not mean autonomous business authority.

A proactive finding may result in:

1. no action;
2. an operator attention item;
3. a safe recovery recommendation;
4. a digital-twin/evaluation request; or
5. a governed proposal entering the existing JAO/Core authority path.

It may never directly mutate QuickFurno business truth, approve itself, send a communication, activate rollout or execute an effect.

A dedicated `apps/proactive-worker` composition may schedule the already-governed JAO-5 ambient cycle in **DORMANT** or **SHADOW** mode only. DORMANT touches no snapshot, database, model gateway or timer. SHADOW is sequential, bounded to 1-60 minute cadence, inherits JAO-5 enrollment/budget/dedupe/quieting/kill-switch rules, halts on a bounded consecutive-failure budget, and has no ACTIVE mode. It may create governed attention evidence; it still cannot execute a business effect.

## Voice consequence

Future always-connected voice is a client of this same proactive intelligence and operator API. Voice does not receive a separate authority model. It may ask Jarvis for the current brief, explain findings, navigate evidence and prepare commands, but any mutating command retains the same authenticated operator-command contract and Core authorization rules as web/mobile.

Wake-word, streaming audio, interruption handling and local speech processing are intentionally deferred to the voice phase. This ADR fixes the intelligence and authority substrate voice will consume so voice does not become a privileged bypass.

## Result

Jarvis evolves from a passive dashboard into a proactive operating layer without creating a second source of business truth or a hidden autonomous execution path. Web, future mobile and future voice clients share the same evidence, priorities, recovery posture and authority boundaries.
