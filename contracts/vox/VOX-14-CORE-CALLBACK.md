# VOX-14 Jarvis -> Core authorization callback — source only

`createVoxCoreSubjectAuthorizer` connects the previously isolated Jarvis signed/replay-once advisory verifier to a reviewed **staging-only HTTPS Core host** and a minimal Core `qf.vox.agent.subject.access.v1` decision. No browser-control endpoint is created.

The backend sends the authenticated staff bearer only in the Authorization header to the exact allowed Core URL; Core itself verifies Supabase Auth AAL2, active staff, team, city, subject grant and current HUMAN conversation revision. The callback validates strict JSON fields and returned identity; it then authorizes one-time claim via the already existing Jarvis PostgreSQL pool.

All requests use a bounded timeout, no redirects, no cache; mismatches, changed scopes, stale revisions and network/database failures fail closed. No raw transcripts, messages, memory, financials or provider credentials are transported.

**NOT operational:** caller must still wire this factory into the authorized Jarvis runtime, create/verify the replay table and deployment secrets, certify Core/Jarvis authenticated HTTPS staging, MFA revocation, concurrency and rollback. Default-off Core flag. Do not pass tokens via logs or expose callback to browser.
