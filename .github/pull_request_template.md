# Pull request

## Phase and scope

<!-- Which phase from docs/architecture/phased-roadmap.md does this deliver? One phase per branch. -->

- **Phase:**
- **Scope:**

## Summary

<!-- What changed, and why. Not a list of files — a description a reviewer can judge. -->

## Architecture boundary

The reviewer's first question is the one from `docs/governance/engineering-principles.md`:

> **Could this change let a recommendation cause an effect without an authorization decision recorded in QuickFurno Core?**

If yes, it does not merge, regardless of what it fixes.

- [ ] This change does **not** create a path from QF Jarvis to n8n, to a provider, or to business state.
- [ ] This change does **not** let QF Jarvis authorize anything, including its own recommendations.
- [ ] This change introduces **no optimistic or local approval state**, and claims no delivery, call completion, or success before an authoritative execution result.
- [ ] This change holds **no provider, WhatsApp, or telephony credential** in QF Jarvis.
- [ ] The permanent boundary in `docs/architecture/system-boundary.md` is unchanged. <!-- Weakening it requires a superseding ADR and the business owner's explicit decision. -->
- [ ] Any architectural decision here is recorded as an ADR.

## Checks run

- [ ] `pnpm check` passes locally (format, lint, typecheck, test, build)
- [ ] CI is green
- [ ] Critical deterministic rules — idempotency, expiry, authorization, bounds, signature and replay, money — were developed **test-first**, or this change introduces none

<!-- Paste anything a reviewer should see, or state plainly what was not run and why. -->

## Exclusions

<!--
State explicitly what this change does NOT add. The exclusions in each phase are
load-bearing: they are what stops a phase from quietly becoming the next three.
-->

## Risk and rollback

- **Risk:**
- **Rollback:** <!-- How is this undone? A change whose rollback plan is "we would have to fix the data" is a migration, and needs a migration plan. -->

## Secrets

- [ ] This change contains **no secrets, credentials, tokens, or `.env` file**, and adds no provider credential to QF Jarvis.
