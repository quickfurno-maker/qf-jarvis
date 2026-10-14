# VOX-16C Jarvis runtime dependency injection (source only)

Wires the existing Jarvis gateway server's optional private VOX read-only handler to **one** existing Jarvis PostgreSQL pool + signed view reader + strict Core subject authorization callback. Only when `QFJ_VOX_ADVISORY_ENABLED=staging`, gateway config environment is `staging`, `QFJ_GATEWAY_TURN_STORE=POSTGRES`, a genuine PostgreSQL pool is present and an operator-provisioned `QFJ_VOX_VIEW_SECRET` of 32+ chars is available. No fallback memory replay store; any unsafe missing config fails startup in staging. Disabled default preserves old gateway.

This is NOT a deployed runtime. Build images must bundle `contracts/vox/*.mjs` at the unchanged relative dist import path; ops must validate that and the real `qfj_vox_agent_replay_receipts_v1` schema, key rotation, signed/private ingress, staging Core hostname, AAL2 and backpressure before flipping any flags. No provider or business action path introduced.
