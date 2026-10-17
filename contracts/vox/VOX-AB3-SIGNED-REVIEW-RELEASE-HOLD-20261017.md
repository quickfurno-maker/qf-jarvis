# AB-3A Jarvis Riya human-review cryptographic boundary

`contracts/vox/ab3SignedHandoverVerifier.mjs` validates **both** signatures: Core's original Ed25519 canonical Riya pause command and Jarvis's separate Ed25519 PAUSED_ACK. The request/ACK must match exact staff, client, conversation, project, nonce, revision and timestamp; independently approved Team Leader and exact current consent/object grant are rechecked before **only** a pending human case is proposed.

Even the successful response returns `takeoverAuthorized:false`, `replyAuthorized:false` and `providerMessagesSent:0`. The gateway `index.ts` does not register this adapter or a provider transport. The existing F1 private gateway pause path remains disabled by default. No actual Core sender, private TLS, database nonce transaction or real staff MFA is certified here.

Four new Node test cases use freshly generated genuine Ed25519 keypairs and exercise tampering, grant/consent revocation, cross-person review and 16 concurrent synthetic same-nonce acceptance attempts (one wins). Full Jarvis VOX contracts and actual built-gateway HTTP Vitest must pass before merge. No managed staging/production deploy; Cursor reviewer deferred.
