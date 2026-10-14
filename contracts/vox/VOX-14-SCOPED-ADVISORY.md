# VOX-14 Core-scoped Jarvis advisory bridge (source-only)

Reuses the existing signed `qf.vox.agent.view.v1` envelope, Jarvis PostgreSQL replay-claim adapter and owner-provided Jarvis pool. Adds **Core authorization before one-time nonce consumption** so users denied access to a prospect/vendor cannot burn the event nonce.

The trusted caller must inject a live, fail-closed `authorizeCoreSubject` callback that verifies the **bearer token against Core + Supabase Auth AAL2**, current user, city/team/object assignment, revocation and HUMAN consent/handover. A callback result with `allowed: true` and matching exact subject is required; this is **not** a browser or model-supplied claim. A callback error, invalid HMAC, expired event, revoked scope or PostgreSQL failure rejects the view.

Only sanitized status fields return. This adds **no gateway HTTP endpoint** and does **not** deliver WhatsApp, open memory, mutate Core, complete handoff or deploy Jarvis. All production runtime integration remains HOLD until signed private staging, exact Core auth route, replay migration and end-to-end traffic certification.

The existing lower-level verifier is retained for trusted internal-only callers; the new adapter is the required future staff-read entrypoint.