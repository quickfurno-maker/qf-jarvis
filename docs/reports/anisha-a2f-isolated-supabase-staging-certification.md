# Anisha A2f — Isolated Supabase staging + branch CI closure

Certification: **2026-10-12 IST**
Status: **isolated database and code-level certification passed, live application deployment and provider activation NOT done**.

## Exact isolated environments

- Core parent: QuickFurno Staging `uckafzuochmbvtiodmcl`; temporary isolated no-data preview branch `wtbldjkqlbweikgestka`.
- Jarvis parent: QF-Jarvis shared `coilipywdvxklewquqvv`; temporary isolated no-data preview branch `ikfasehnptqkuqpxhzqe`.
- Both created after the tool's explicit cost confirmation, at quoted **US$0.01344 per branch-hour** (other usage charged separately). They were **deleted after certification**, verified only default main branches remain. No lingering preview branch compute by request of cost control. See Supabase usage/invoice for actual charge.
- The two parent projects remained untouched; post-certification read-only probe confirms absence of ANISHA memory/consent schema on both parents.

## Schema, security and hosted synthetic-data results

- All four reviewed Core/Jarvis migration sources applied successfully via managed migration tool, **only** to preview branches:
  - Core purpose consent + outbox `20261012080000`
  - Core lease/ACK `20261012100000`
  - Jarvis governed memory `0001`
  - Jarvis durable erase write fence `0002`
- Confirmed Core consent + outbox **RLS enabled**, anon consent mutation denied, authenticated purge claim denied. Jarvis memory table and exact write-fence trigger exist. Jarvis database security advisor: no findings; Core inherited RLS/no-policy informational notices requiring security interpretation, not public exposure.
- One **synthetic, inactive vendor** with no real account/phone used as test Core identity; three synthetic memory rows. Core explicit GRANT created revision 1; REVOKE created revision 2 with pending physical purge.
- Core `CLAIM` issued a one-time vendor/purge/lease token. Jarvis isolated branch transaction acquired subject advisory lock, inserted fence, physically deleted only the vendor's Anisha memory while preserving unrelated agent and vendor records. Core `ACK` accepted exact lease **after** deletion; pending purge count became zero, vendor remained DENIED.
- A second explicit Core GRANT raised revision 4, timestamp **later than** the persistent fence. Authorized synthetic re-enrollment transaction validated the ordering, cleared fence and permitted a new derived preference. Core REVOKE revision 5 caused second physical erase and second valid Core ACK. No pending purges remained.
- All synthetic vendor, outbox, memory and fence rows removed after proof. Final hosted isolated DB rows for these test fixtures: **0**. Preview branches then deleted.
- This is a **hosted separate-database protocol drill orchestrated by admin tools**, not proof that deployed application HTTP routes performed the whole flow.

## Build / regression certification

- Added standalone, no-secrets GitHub workflows restricted to the two feature branches. Both remote workflow runs completed **SUCCESS**:
  - Jarvis: https://github.com/quickfurno-maker/qf-jarvis/actions/runs/38218300519
  - Core: https://github.com/quickfurno-maker/quickfurno-marketplace/actions/runs/38218308140
- Jarvis pre-change baseline: 208/208 focused regression tests (including 5 real local PG adapter tests and 2 real localhost signed HTTP tests). Subsequent staged write integration checks passed **61/61** relevant tests, and API TypeScript succeeded with source resolution. Added exact-string allowlisted language/reply-style recognition; only signed ANISHA vendor turns with non-null model proposals and purpose consent can write. No raw transcript, free-text LLM extraction, wallet, credit, payment or lead truth written.
- Fixed activation invariant: staging preference **read/write mode cannot be enabled unless the independent physical erasure and 30-day TTL purge worker is enabled**. Focused gate tests 52/52 passed locally; full branch CI must re-run on the final invariant commit.
- Existing A1 identity, Core signing, human takeover, no provider sends, max-three assignments and Riya/Aarohi role boundaries retained.

## Still requires controlled external approval/deployment

1. **Approved vendor privacy notice and owner sign-off.** UI copy is prepared but is a draft. Marketing/WhatsApp opt-in is not derived-memory consent.
2. **Actual isolated deployed Next.js Core + Jarvis worker service-to-service signed HTTPS** certification with agreed stage hosts, secret references, network policies and provider-send disabled; localhost crypto and database drills do not substitute.
3. Stacked PR merge/release management: Core #182→#183, Jarvis #319→#320→#321→#322, exact CI rebuild, human security review and rollback record. Do not auto-merge drafts into main.
4. If another hosted stage drill is required, temporarily re-create isolated branches with explicit cost confirmation; never apply ANISHA SQL to shared Jarvis or production without backup/migration promotion authorization.
5. **Production memory, provider messaging and durable memory defaults remain OFF**. No production migrations, real vendor data, WhatsApp sends or credits affected.

## Verdict

**Internal engineering and hosted isolation certification GREEN; production/real staging application activation HOLD.** Remaining blockers are privacy sign-off and actual stage deployments/security-reviewed release promotion, not a missing memory engine.
