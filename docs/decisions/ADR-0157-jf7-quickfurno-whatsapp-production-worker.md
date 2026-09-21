# ADR-0157 — JF-7 QuickFurno WhatsApp production worker

## Status

Accepted for implementation. Production activation remains gated by JF-5B/JF-5C evidence and explicit operator enablement.

## Context

QuickFurno owns conversational business truth and final Meta send authority. The existing signed
QuickFurno gateway durably spools inbound turns, but a production worker is required to consume that
spool, run the exact certified Jarvis specialist release, and return only a proposal for QuickFurno to
re-authorize.

The generic QuickFurno Core decision route intentionally has no production authorizer for this
WhatsApp send path. Requiring a Jarvis reply to pass that route before reaching
`/whatsapp-reply` would make the WhatsApp worker permanently fail closed at the wrong boundary.

## Decision

1. The worker consumes the same durable file spool written by `quickfurno-gateway`.
2. QuickFurno remains the authority for tenant/conversation identity, subject/party type, assigned
   actor, revision, conversation state, privacy/data class, consent, service-window/provider state and
   final send.
3. Every Jarvis authority read is signed and revalidated. Jarvis independently enforces the canonical
   mapping `client→CLIENT→RIYA`, `vendor→VENDOR→ANISHA`, `prospect→PROSPECT→AAROHI`.
4. The WhatsApp path uses the Jarvis proposal-only projection. Text is materialized only for
   `MODEL_DRAFTED` with `coreConsulted=false`, and is explicitly
   `PENDING_CORE_VALIDATION`. Existing `CORE_ACCEPTED` APIs are unchanged.
5. The worker submits that proposal to QuickFurno `/whatsapp-reply`; QuickFurno re-reads current
   authority and alone decides whether the proposal may enter its governed Meta outbox.
6. Serving code consumes neutral immutable production profile facts and a finished JF-5C seal. It
   does not import the live JF-5B certification operator.
7. Production inference is Groq-only, exact-release, no fallback, retry budget zero, with an
   emergency filesystem kill switch checked before claims and again by the model gateway.
8. The worker has no listener and no public port. Deployment is non-root, read-only rootfs,
   cap-drop ALL, no-new-privileges, with only the shared spool writable.
9. The exact merged git SHA, exact JF-5C v2 seal and exact prompt-scoped approvals must agree before
   the worker can start.
10. Starting the worker does not itself activate QuickFurno conversational traffic.

## Consequences

- A QuickFurno state/revision/actor change during model execution causes the proposal to be withheld
  or rejected at the final QuickFurno boundary.
- Generic Core rejection/unavailability cannot be bypassed by the proposal API when a Core transport
  is configured; proposal materialization exists only when Core is deliberately deferred to the
  trusted QuickFurno WhatsApp boundary.
- Jarvis never becomes a writer of QuickFurno business state and never receives QuickFurno database,
  Supabase service-role or Meta credentials.
- Final rollout still requires fresh exact-head JF-5B, three blinded human ACCEPT reviews, owner
  acceptance, JF-5C v2, exact-SHA deployment, a real Meta canary and explicit activation.
