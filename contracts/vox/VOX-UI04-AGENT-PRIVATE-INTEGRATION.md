# VOX UI-04 Agent Bridge — source-only private integration (17 Oct 2026)

**RELEASE HOLD: no HTTP registration in deployed Jarvis, no external sends, no production permission.**

Modules:
- `ui04AgentDeskReadiness.mjs`: current Core AAL2 Staff and exact subject grant rechecks for Riya/client, Anisha/vendor and Aarohi/prospect metadata. It rejects cross-city/team/duplicate conversations and vendor staff access to Riya without independent client-success department authorization. Consent is a read-only advisory; it never allows a reply, takeover, transcript or WhatsApp send.
- `ui04PrivateAgentMount.mjs`: integration *proposal* around existing `createF1RiyaPauseHttpHandler`. Requires all three staging feature flags, the existing signed QFJ/Core transport and current Core grant/consent/atomic Jarvis pause callbacks. Calls injected `registerPrivatePost` with `privateIngressOnly: true` and `exposeViaPublicTraefik: false`; refuses missing/false registration receipts. Additional injected private-gateway boundary refuses requests before existing m2m signature check. This is **not** a live router or new public origin.
- `ui04Agents.test.mjs`: focused negative tests for lane mismatch, revoked grants, consent, replay/expiry constraints inherited from F1 signed handler, forged private registration, disabled flags and false public authorization.
- `.github/workflows/vox-ui04-agents-release-hold.yml` CI reruns all Jarvis VOX tests and disposable network-isolated PostgreSQL 17 signed pause/replay SQL.

No duplicate agent models, WhatsApp providers, Auth store or new permissions. Cross-repo synthetic harness on JARVIS validates safe Core work/Client queue + Jarvis Riya metadata interoperability, but is not genuine live HTTPS/QFJ m2m certification.

**Pending actual wiring:** approved signed Core pause issuance; verified Jarvis local route registration; private TLS; approved protected staging DB transaction adapter, AAL2 current grants and consent revision; human handover approval; independent AppSec/release and Owner GO. Riya pause ACK does not approve real takeover or sending.
