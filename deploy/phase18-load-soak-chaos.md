# Jarvis Phase 18 — Load, Soak, Chaos & Failure Certification

Jarvis follows the byte-identical `qfj.phase18.cert.v1` policy.

The Phase 18 gate combines existing real resilience tests for provider failures, durable turn spooling, PostgreSQL connection budgets, horizontal WhatsApp workers and QuickFurno/Jarvis transport timeouts with the shared sustained-soak harness.

Jarvis must remain bounded when model providers time out or rate-limit, when QuickFurno is unavailable, when Redis notification delivery is lost, and while N/N-1 app versions overlap. Durable work remains PostgreSQL-backed; Redis/Valkey is coordination/wakeup only.

At overload, controlled failure is preferred to hanging or correctness loss. Provider/model latency is separated from platform overhead. No provider failure may create duplicate sends, duplicate durable turns, authority expansion or corruption of QuickFurno business state.

Phase 18 is isolated certification only: no production load test, production DB mutation, traffic cutover, credential change or new AGNI authority.
