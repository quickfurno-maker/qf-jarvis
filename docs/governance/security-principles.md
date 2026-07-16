# Security Principles — QF Jarvis

**Status:** Phase 0 — Approved
**Date:** 2026-07-11

Mechanisms are chosen in Phase 1 and hardened in Phase 13. These are the principles those mechanisms must satisfy. The boundaries they apply at are mapped in [trust-boundaries.md](../architecture/trust-boundaries.md).

---

## 1. Least privilege

Every component gets the minimum access it needs, and nothing more.

- **Agents** receive only the data their domain requires. Jitin does not get client phone numbers; Kabir does not get payment history ([ADR-0006](../decisions/ADR-0006-agent-responsibility-boundaries.md)).
- **QF Jarvis** has no write access to business state, no path to n8n, and no provider credentials.
- **Model access is mediated, not distributed.** Agents call the internal **model gateway** (Phase 4.0), never a provider directly, and every capability an agent may invoke is a **declared, bounded, contract-typed door** (Phase 4.1) — never arbitrary SQL, shell, filesystem access, URL fetching, generic provider invocation, or unrestricted document retrieval ([model-runtime-and-governance.md](../architecture/model-runtime-and-governance.md), [governed-knowledge-and-capabilities.md](../architecture/governed-knowledge-and-capabilities.md), [ADR-0028](../decisions/ADR-0028-ai-runtime-foundations-and-roadmap-sequencing.md)). **Approved architecture, not implemented.**
- **Provider credentials in n8n** are scoped to the minimum each integration needs — one compromised credential must not reach another provider.
- **Human approvers** have delegated limits. Money escalates ([ADR-0005](../decisions/ADR-0005-human-and-policy-approval.md)).

The strongest form of least privilege is **not having the capability at all**. Jarvis's inability to call a provider is not a permission check that could be misconfigured — it is the absence of an integration and the absence of a secret. That is why the boundary is a security control, not just an architectural preference.

## 2. Deny by default

Everything is refused unless it is explicitly permitted.

- An unsigned, badly-signed, or unknown-version event is **rejected**, not processed "just in case."
- An execution intent that fails any validation — authenticity, integrity, freshness, bounds — is **not executed**.
- An unsolicited provider callback that correlates to no known intent is **discarded and alerted**.
- An action not covered by an existing policy requires the founder's decision. It does not default to allowed ([execution-governance.md](../architecture/execution-governance.md)).
- **Silence is never consent.** An undecided recommendation expires; it does not auto-approve.

## 3. Signed service communication

Every message crossing a system boundary is signed by its sender and verified by its recipient: Core → Jarvis (events), Jarvis → Core (recommendations), Core → n8n (intents), n8n → Core (results).

Signing keys between systems are **distinct**. A compromised Jarvis key must not let an attacker impersonate Core to n8n — which is the difference between "the intelligence layer is compromised" and "the attacker can now spend money."

## 4. Secret isolation

- Secrets live in a **secret store**. Never in source, never in committed configuration, never in an environment dump, never in a log line.
- **Provider credentials exist only in n8n's trust zone.**
- Secrets are scoped narrowly and rotated.
- A developer must never need a production secret to do their job.

## 5. No secrets in logs

Not keys, not tokens, not signatures, not authorization headers. This extends to error messages, stack traces, and debug output — which is where secrets actually end up, not in the log lines people write deliberately.

Sensitive-data logging incidents have a target of **zero**, and any occurrence is an incident ([success-metrics.md](../charter/success-metrics.md)).

## 6. Replay protection

Every boundary rejects a message it has already seen, and every boundary rejects a message too old to still be valid.

- Events carry unique identifiers and timestamps.
- Execution intents **expire**, and a previously-executed intent identifier cannot be re-executed.
- Provider callbacks are correlated to a known intent and de-duplicated.

Replay protection and idempotency are different defenses and both are required: replay protection stops a *hostile* repeat; idempotency makes an *accidental* repeat harmless. A system with only one of them fails in a way the other would have caught.

A legitimate operational replay — reprocessing history after fixing a bug — is a **distinct, authorized operation**, not an accident of redelivery.

## 7. Key rotation

- Keys rotate on a schedule, and **immediately** on any suspicion of compromise.
- Rotation completes **without downtime and without a code change** — a rotation procedure that requires a deploy is a rotation procedure that will be skipped under pressure.
- Rotation is **tested**, not merely documented. Phase 13's exit criteria require it to be exercised.

## 8. Auditable authorization

Every authorization decision names its decider: a human, or a named and versioned policy. No shared approver accounts. No anonymous approvals. No inferred approvals.

A policy that authorizes automatically is attributable **exactly as a human approver would be** — which policy, which version, which conditions matched. Automation does not dilute accountability; it relocates it to the person who approved the policy.

**Attribution requires identity, and identity comes first.** Named individual accounts, no shared approver accounts, MFA, role-based access control, step-up authentication for sensitive actions, and session and device revocation are established in the **Phase 8.5 Human Identity and Access Foundation — before approval is exposed to people in Phase 9** ([production-readiness-and-access-control.md](../architecture/production-readiness-and-access-control.md), [ADR-0028](../decisions/ADR-0028-ai-runtime-foundations-and-roadmap-sequencing.md)). Approved architecture, not implemented.

## 9. Bounded execution

An execution intent authorizes **one specific thing**: exact action, exact subject, exact provider and channel, exact parameters, with an expiry and an idempotency key. Anything outside those bounds is unauthorized.

n8n has **no discretion**. It does not interpret, expand, or helpfully adjust an intent — because discretion is precisely where an execution fabric becomes a decision-maker, and the decision was supposed to have been made already.

**Rate and volume bounds** apply at the provider boundary, so that a fault or a compromise cannot become a mass-outreach or mass-spend event before a human notices.

---

## Prompt injection is a live threat, not a hypothetical

Lead free-text, client messages, and vendor profile content are **attacker-influencable** and they enter agent context. Assume hostile content will arrive, because eventually it will.

**What the architecture already gives us:** a model that has been fully hijacked by injected instructions still cannot authorize anything, cannot execute anything, cannot call a provider, and cannot write business state. Its maximum output is a *misleading recommendation*.

**This matters most now that Jarvis coordinates calls and WhatsApp messages.** A hijacked agent cannot dial. It holds no telephony or WhatsApp credential, and it cannot supply a recipient: **Core resolves the recipient from its own contact identity**, so a request naming an attacker's number is refused rather than dialled. The attack degrades from *"make the system call me"* to *"make the system suggest something odd to a human who can see the evidence"* ([ADR-0008](../decisions/ADR-0008-controlled-communication-capability.md)).

**What we still owe:** that recommendation is aimed at a human approver, so the defenses are —

- Untrusted content is clearly delimited in agent context and never treated as instruction.
- Agent outputs are **contract-validated**; a malformed output is a failure, not something to coerce into shape.
- **Evidence must reference real event identifiers** that a reviewer can check against QuickFurno Core's own records. A fabricated justification does not survive contact with the evidence panel.
- Approvers see the **evidence**, not only the conclusion ([recommendation-lifecycle.md](../architecture/recommendation-lifecycle.md)).

The containment property here — *the worst a compromised agent can do is propose* — is the single strongest security argument for the whole boundary, and it is why the boundary is not negotiable for convenience ([ADR-0002](../decisions/ADR-0002-recommend-authorize-execute-model.md)).

## Assume compromise

Design as though each component will eventually be compromised, and ask what holds.

| Compromised | Attacker gains | What holds |
| --- | --- | --- |
| **QF Jarvis** | The ability to produce misleading recommendations and communication *requests* | Cannot authorize, execute, call anyone, message anyone, move money, or alter business truth. Holds no WhatsApp or telephony credential. Cannot choose a recipient — Core resolves that from its own contact identity. Cannot bypass consent or do-not-contact, which Core enforces and the runtime re-checks |
| **A provider credential in n8n** | The ability to act through that one provider, within its scope | Scoped credentials contain it; rate and volume bounds cap it; execution results still flow to Core, so it is visible in the audit trail rather than invisible; Core's truth is not corrupted |
| **A signing key** | The ability to impersonate one system to another | Distinct keys per boundary limit the blast radius; rotation is immediate and requires no deploy |
| **An approver account** | Real authority, within that approver's delegated limits | Strong authentication, no shared accounts, session expiry, delegated limits, money escalates, and every action is attributable and audited |

The last row is the most dangerous, which is the correct conclusion: **in this architecture, the most valuable credential is a human approver's — and that is by design.** The system is built so that the authority worth stealing belongs to a person who can be held accountable, rather than to a model that cannot.
