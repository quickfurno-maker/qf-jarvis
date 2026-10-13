# qf.vox.agent.view.v1 — Jarvis to VOX advisory bridge

Source-only contract. NO production route, NO live message sends, NO memory reads/writes, NO user-facing auth changes. Only a server-secret authenticated, short-lived, narrow projection for verified backend callers.

Aarohi -> ACQUISITION/prospect; Anisha -> VENDOR_SERVICE/vendor. Signed payload includes schema, issuer, audience, agent, channel, subjectType, subjectId, jti, revision, iat/exp (max 300s), memoryStatus enum, humanTakeover and an optional short lastEvent. Never includes raw message content, user phone, financial authority, memory material or Core vendor status.

The receiving VOX server MUST validate signature/time/agent-channel pairing _and maintain a persistent idempotency/replay ledger_ keyed (iss,jti) before acting on any request. This verifier intentionally does not claim replay immunity by itself. The producer should sign from a trusted Jarvis service, never browser JS or prompts. No direct actions/calls through this contract.

Core remains authoritative for vendor status, payment, consent and outbound WhatsApp. Human takeover uses the existing Core governed queue and Jarvis stop-policy, never an event claim or new Meta sender. This contract exists to support VOX-00 independent integration design and fail-closed tests, not to activate production.
