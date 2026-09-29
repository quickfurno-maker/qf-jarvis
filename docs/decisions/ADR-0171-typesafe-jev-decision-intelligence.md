# ADR-0171 — TypeSafe Jev as bounded decision intelligence

**Status:** Accepted
**Date:** 2026-09-29

## Decision

Jarvis integrates TypeSafe Jev as a separate System One decision-intelligence layer, not as a text
model in the Model Gateway and not as a second agent router. The existing deterministic assignment
router remains the only authority for Riya, Anisha, Aarohi, Jarvis, and Human ownership.

The provider-neutral `@qf-jarvis/decision-intelligence` package defines bounded Boolean, Choice and
Score questions plus an advisory Jarvis preflight. The TypeSafe-specific
`@qf-jarvis/jev-decision-adapter` maps those contracts to Jev's Noul, Choice and Score API.

Jev may advise on task shape, ambiguity, human-review need, and one candidate action drawn from a
caller-supplied reviewed set. Every advisory explicitly carries `actorAssignmentMutable: false`,
`actionProposalAuthorized: false`, and `executionAuthorized: false`.

Only `HOSTED_ALLOWED` state may reach Jev in this slice. `LOCAL_ONLY` and `HUMAN_ONLY` fail before
transport. Any later widening requires a separate privacy review and certification.

The adapter accepts an injected, non-printable TypeSafe API key, uses only the fixed official
`api.typesafe.ai` endpoints, follows no redirects, bounds response bytes, performs no retry, reads no
environment variable, and fails closed on malformed output.

## Why

Jev is optimized for fast structured decisions rather than generated strings. Keeping it outside the
LLM gateway preserves the gateway's meaning and lets Jarvis combine deterministic code, System One
judgment, and generative reasoning without confusing their authority.

This shape also scales to future agents: the decision layer receives an opaque bounded `actorRef` and
reviewed candidate actions from the caller. Adding an agent does not require Jev to become the owner
of the assignment vocabulary.

## Activation

This ADR establishes code and containment only. Production activation requires a separately installed
TypeSafe credential, authenticated model discovery, representative evaluation, confidence-threshold
calibration, observability, budget/rate-limit policy, and a deployment composition that remains
fail-closed when Jev is unavailable.
