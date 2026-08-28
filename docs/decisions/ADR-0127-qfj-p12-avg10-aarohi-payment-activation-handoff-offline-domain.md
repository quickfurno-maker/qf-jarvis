# ADR-0127 — QFJ-P12 / QVGE / AVG-10: the Aarohi PAYMENT, ACTIVATION and ANISHA HANDOFF OFFLINE DOMAIN

- **Status:** Accepted (offline domain only; runtime PLANNED / DISABLED)
- **Owner phase:** QFJ-P12 — Aarohi Vendor Growth and Acquisition
- **Overlay stage:** AVG-10 — Payment, Activation and Anisha Handoff
- **Certified qf-jarvis baseline:** `7765c52de546aa98a1a05545517a6cadd3946756` (PR #168 / AVG-9 merge)
- **QuickFurno marketplace commit inspected:** `06b1e22cfa866cd3840c7ecb065b9d0c4acb8bca` (read-only)
- **Supersedes:** nothing
- **Related:**
  [ADR-0085](ADR-0085-qfj-p12-aarohi-vendor-growth-and-roadmap-reconciliation.md) (governing
  architecture, the acquisition-case lifecycle and the ACTIVE handoff),
  [ADR-0124](ADR-0124-qfj-p12-avg7-aarohi-sales-brain-offline-domain.md),
  [ADR-0125](ADR-0125-qfj-p12-avg8-aarohi-commercial-truth-package-engine-offline-domain.md),
  [ADR-0126](ADR-0126-qfj-p12-avg9-aarohi-registration-integration-offline-domain.md)

---

## Context

The canonical overlay sentence for this stage, in full:

> **AVG-10 — Payment, Activation and Anisha Handoff.** Payment follow-up during acquisition, and the
> moment the relationship changes hands. Payment and activation authority are **Core's alone**. On
> Core's authoritative ACTIVE confirmation, Aarohi's acquisition mandate ends and Anisha becomes the
> vendor relationship owner.

The sentence names two things, and this stage is the insistence that they stay two.

### The failure this stage is designed against

**They paid, so they are live.**

It is the most natural inference in the domain, it is wrong, and it is wrong in a way that is very
hard to see afterwards. A payment fact — even an authoritative one — says money moved. Going live is
a separate decision Core makes separately, and QuickFurno's own data model says so out loud: a paid
order and an activated vendor are different rows written by different admin actions. A system that
collapses them hands a vendor relationship to Anisha for a party who is not live, and does it while
looking correct.

A second failure sits underneath it. Aarohi observes conversations, and conversations contain
sentences like _"I've paid, when do I go live?"_. Every substitute for Core's confirmation is
available and plausible: the message, a provider receipt, a model's reading, Aarohi's own case
state. AVG-1 enumerated all four so their refusal could be proved rather than assumed; AVG-10 is
where they would actually be reached for.

---

## The read-only Core audit

Inspected at commit `06b1e22cfa866cd3840c7ecb065b9d0c4acb8bca` of
`quickfurno-maker/quickfurno-marketplace`. Nothing was modified, imported or called.

### Payment and activation surfaces, classified

| Surface                                                                                                                                           | Kind      | Note                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------- |
| `vendorPackageOrderService.listVendorPackageOrders(vendorId)`                                                                                     | **READ**  | keyed by Core **vendor id**; returns `payment_status`, `activation_status`, `paid_at`, `activated_at`, provider ids |
| `vendorPackageOrderService.getVendorCurrentPackageSummary(vendorId)`                                                                              | **READ**  | keyed by Core **vendor id**; `active_package.payment_status` from `vendor_packages`                                 |
| `vendorAdminService.getVendorsWithEligibility()`                                                                                                  | **READ**  | admin-wide list; `is_active`, `status`, computed eligibility                                                        |
| `adminSectionService.getAdminPaymentsPage(query)`                                                                                                 | **READ**  | admin dashboard page over `payments`                                                                                |
| `vendorPackageOrderService.createVendorPackageOrder`                                                                                              | **WRITE** |                                                                                                                     |
| `packageService.createManualPayment`, `markPaymentPaid`                                                                                           | **WRITE** | `payments.payment_status` `Pending` → `Paid`                                                                        |
| `packageService.assignPackageToVendor`, `assignPackageAfterPayment`                                                                               | **WRITE** | via RPC `assign_package_to_vendor`                                                                                  |
| `vendorCreditWalletService.applyVendorCreditDelta`, `grantVendorCredits`, `grantCreditsForConfirmedPackagePurchase`, `refundCreditForInvalidLead` | **WRITE** |                                                                                                                     |
| `vendorAdminService.setVendorStatusAction(id, 'activate' \| 'deactivate' \| …)`                                                                   | **WRITE** | activation is a boolean `is_active`                                                                                 |
| `vendorAdminService.updateVendorCredits`, `updateVendorPackage`, `updateVendorVisibility`, RPC `update_vendor_visibility`                         | **WRITE** |                                                                                                                     |

### Three findings that decided the design

**1. Every per-party read is keyed by a Core VENDOR ID, which Aarohi structurally does not hold.**
A prospect is explicitly not a vendor — that is AVG-1's founding distinction and the reason
`prospectRef` exists. There is no read contract that answers a payment or activation question about
a party Aarohi can name.

**2. The order lifecycle is not a lifecycle yet.** `vendor_package_orders.payment_status`,
`order_status` and `activation_status` are `text` columns with **no CHECK constraint**. The only
writer is `createVendorPackageOrder`, which sets them to `created`, `not_started` and
`not_activated` — over `payment_provider: "not_connected"` and `payment_method: "online_future"`.
Nothing in the repository advances them. Mirroring `payment_status: string` would be mirroring a
field with no vocabulary and no transitions.

**3. Core has no ACTIVE vendor status.** `vendors.status` is constrained to
`('Pending','Approved','Rejected','Suspended')`. "Active" is a separate boolean `is_active`, and
`package_status` uses a lowercase `active`. AVG-1's `CorePartyStatus.ACTIVE` and the ACTIVE
attestation are Jarvis-side abstractions over _"Core says this party is live"_, not a mirror of a
Core enum — worth stating plainly, because a future reader will otherwise go looking for the enum.

### The decision that follows

**No clean prospect-facing payment or activation READ contract exists, so nothing is mirrored and no
payment lifecycle is invented.** There is no `PAYMENT_PENDING`, `PAYMENT_COMPLETED`,
`PAYMENT_FAILED`, `ACTIVATION_READY` or `ACTIVATION_PENDING` in this contract. What is carried is a
closed AVAILABILITY token and an OPAQUE reference to Core's own material — the same restraint
ADR-0126 recorded about registration, arrived at from a different direction and for a stronger
reason: here a plausible invention would be about money.

Core's WRITE paths are banned by their **real names**, discovered by audit rather than guessed at,
across every production file in the package. A generic word ban is the one that quietly stops
matching when somebody renames a service.

---

## Decision

### 1. Availability, in three closed members, exactly one of which proceeds

```
CORE_AUTHORED_PAYMENT_CONTEXT_AVAILABLE      → the only member that proceeds
CORE_AUTHORED_PAYMENT_CONTEXT_UNAVAILABLE    → Core answered: it has none
CORE_PAYMENT_CONTEXT_UNKNOWN                 → nobody asked, or nobody replied
```

A spec asserts no member contains `PAID`, `PENDING`, `FAILED`, `REFUND`, `SETTLED`, `COMPLETED`,
`ACTIVE`, `ACTIVATION`, `READY` or `DUE`. The absence branch is a switch with no default over the two
non-proceeding members, so a fourth token fails to compile until somebody decides what it means.

The observation is a discriminated union: `corePaymentContextRef` exists only on the `AVAILABLE`
variant, so a context cannot say Core holds nothing and then name it.

### 2. Payment is not activation, as a shape rather than a rule

This is the stage. The payment-follow-up brief has **no `authority`, no `active`, no
`coreAttestationRef` and no acquisition case**. Consequently:

- it does not parse as an `ActivationAttestation`, and a spec hands it to `completeCoreActiveHandoff`
  and asserts `ATTESTATION_INVALID`;
- decorating it with `authority` and `active` does not help, because the attestation schema is strict
  and knows four fields — also asserted;
- there is no function anywhere that turns a brief into an attestation.

The posture keeps the two truths apart as separate literals — `requiresCorePaymentTruth: true` and
`requiresCoreActivationTruth: true` — rather than folding them into one field, because folding them
is precisely the conflation. `activationInferred: false` is the field to read twice.

### 3. `completeCoreActiveHandoff` remains the only route, and AVG-10 does not touch it

No wrapper, no composition, no orchestration function. AVG-10's production module does not import,
name or reference `active-handoff.ts` at all, and a spec asserts its import list is exactly zod,
AVG-7 and AVG-1's refusal type.

That is a stronger statement than composing the handoff carefully. A wrapper would have added public
surface and no authority, and the one thing a second entrance to a terminal state can never be is
safer than one. What AVG-10 adds instead is **certification**: its suite drives all five
`ACTIVATION_AUTHORITIES`, both values of `active`, a wrong prospect, malformed attestations, every
non-boundary case state, every terminal state, and every state of the generic transition table — and
asserts the ordinary lifecycle still cannot reach `HANDED_OFF_TO_ANISHA` from anywhere.

### 4. Only `PAYMENT_OR_ACTIVATION`, checked on the re-derived intent

AVG-7 routes `REGISTRATION_PROCESS` and `PAYMENT_OR_ACTIVATION` to one
`REQUEST_CORE_PROCESS_CONTEXT`. AVG-9 and AVG-10 hold that door from opposite sides, and each checks
the re-derived INTENT rather than the shared strategy. `REGISTRATION_PROCESS` is refused here by its
own token, as `PAYMENT_OR_ACTIVATION` is refused there.

The plan is re-derived through AVG-7's own evaluator and compared **structurally** — key sets in both
directions, nested records recursed, leaves compared with `Object.is` — carrying AVG-7's latest-turn
binding, its causal chain and the CURRENT AVG-1 gate across. The gate runs once, inside that
re-derivation, and its refusal is surfaced with AVG-1's own reason rather than flattened.

The comparison is restated rather than imported from AVG-9. The two stages share a pattern, not a
dependency: making a payment boundary import a registration module would couple two deliberately
separate stages through a utility, and exporting the helper would put an implementation detail on a
locked public surface. Both suites prove the behaviour independently.

### 5. The cold-acquisition gate is unchanged and unwidened

`ELIGIBLE_CORE_STATUSES` is still exactly `NOT_REGISTERED`, and a spec asserts it. AVG-10 does not
name `CORE_STATUS_ROLE`, `ELIGIBLE_CORE_STATUSES` or `evaluateAcquisitionEligibility`.

This has a consequence worth stating plainly rather than discovering later. **Because the gate runs
inside the re-derivation, a payment-follow-up brief is reachable only while Core still reports the
party `NOT_REGISTERED`.** A prospect who has genuinely registered becomes `REGISTERED`, and every
AVG-10 path then refuses.

That is the correct behaviour for this slice and it is also an admitted limitation. The real
post-registration conversation — a registered, unpaid vendor being followed up — needs a **separate,
explicit, Core-authoritative continuation boundary for the same acquisition**, and it must never
become general permission to cold-acquire registered vendors. That boundary does not exist, and
AVG-10 did not invent it. Widening the cold gate to reach the conversation would have been the
architecture violation this overlay exists to prevent.

### 6. The `AWAITING_CORE_ACTIVATION` bridge was deliberately NOT added

`AWAITING_CORE_ACTIVATION` and `CONTACT_APPROVED` have **no inbound transition** in
`ACQUISITION_CASE_TRANSITIONS` — they are authority-shaped states reserved for future Core-bound
bridges. A bridge into the activation boundary would be the natural thing to add here, and it was
considered and refused.

The condition for adding one is a trustworthy Core fact that justifies entering the boundary. The
audit found none: there is no prospect-facing readiness signal, no per-party payment read Aarohi can
key, and no ACTIVE status in Core's vocabulary. Manufacturing a bridge on an invented readiness fact
is exactly the failure ADR-0126 refused about registration, and it would be worse here because the
next state after the boundary is the terminal one.

So the first AVG-10 proof is narrower and honest: certify payment-follow-up context, and certify the
existing Core ACTIVE handoff using a case already at the boundary. **The pre-handoff bridge remains
future work**, a spec asserts the state is still unreachable by ordinary transition, and neither
`acquisition-case.ts` nor `active-handoff.ts` was modified.

### 7. No money, no instrument, no secret

The brief carries no amount, currency, price, package, credits, order id, transaction id, provider,
method, paid-at, activated-at or status string, and no explanation, reminder or reply field. A spec
scans every key of a produced brief against all of those shapes, and asserts the **only number in the
artifact is its contract version** — because an amount cannot hide in a numeric field when there is
no numeric field.

`corePaymentContextRef` is an AVG-10-LOCAL reference and carries the full screen: contact shapes plus
a digit count. That is what refuses a pay-here link, an address, and a card-length run of digits. The
inherited references keep the upstream grammar untouched, and a spec carries a numeric and a
host-shaped upstream token end to end into a brief.

---

## Mutation findings

Sixty-one negative mutations were applied to real source, each followed by the full
`@qf-jarvis/aarohi-agent` suite and a SHA-256-verified byte-identical restore. No `git reset`, no
`git clean`: owner untracked files were never touched. The runner executes
`node node_modules/vitest/vitest.mjs` and distinguishes "the suite ran and specs failed" from "the
suite did not run", for the reason ADR-0126 records.

**Sixty were caught. One survived, and it is reported rather than hidden.**

The campaign deliberately reached beyond AVG-10's own module into the three certified contracts this
stage rests on, because certifying a boundary means being able to break it: making a provider receipt
the trusted authority, removing the authority check, accepting `active: false`, bypassing the case
boundary, accepting another party's attestation, adding `HANDED_OFF_TO_ANISHA` to the generic
transition table, and widening the cold gate to admit `REGISTERED`. All seven were caught, several by
AVG-1's own specs together with AVG-10's — which is the correct result: the boundary has two
independent proofs and this stage did not weaken either.

**The one survivor: removing the final output re-parse.** The builder constructs its brief from
values every one of which has already been validated — the references by their schemas, the instants
by the causality guards, the outcome and posture from frozen constants — so it cannot produce a brief
its own schema would reject, and no spec can make it. This is the same structurally-unreachable
survivor ADR-0126 reports for AVG-9, and it is kept for the same reason: it is correct, it is the
last line of defence if a future field arrives without a guard, and a check deleted for being
currently redundant is not there on the day it matters. Padding the count by deleting it would have
made the proof look stronger than it is.

---

## What AVG-10 deliberately does not do

| Left out                                                 | Owner                                                   |
| -------------------------------------------------------- | ------------------------------------------------------- |
| Taking, recording, confirming or reconciling a payment   | **QuickFurno Core**                                     |
| Creating an order, assigning a package, granting credits | **QuickFurno Core**                                     |
| Activating a vendor, or establishing ACTIVE              | **QuickFurno Core**                                     |
| A payment lifecycle vocabulary, or any payment state     | **QuickFurno Core**                                     |
| The `AWAITING_CORE_ACTIVATION` bridge                    | future work, once Core exposes a fact that justifies it |
| A post-registration continuation boundary                | future work, and never a widened cold gate              |
| Analytics, admin APIs, dashboards                        | AVG-11                                                  |
| Any increase in autonomy                                 | AVG-12                                                  |
| Drafting the follow-up itself                            | later composition through QF Model Gateway              |
| Live Core reads, payment providers, n8n routes, sends    | **QFJ-P09**                                             |

Dependencies are unchanged: `zod` alone. No devDependencies, no workspace dependency, no lockfile
change, no payment-gateway SDK, and no dependency on the QuickFurno marketplace in either direction.

---

## Consequences

Aarohi can now record that Core holds payment-follow-up context for an acquisition, and still cannot
do anything about money at all.

The value is narrow and worth stating plainly. When a governed composition is eventually built, it
will attach to a domain where a payment cannot be confirmed because there is no field to confirm one
in, a payment state cannot be invented because Core owns no vocabulary to copy, an amount cannot
appear because the artifact holds no numbers, and — the one that matters most — a payment can never
become an activation, because the artifact that carries payment context is not the artifact the
handoff accepts and no code connects them.

**Runtime status is unchanged: PLANNED / DISABLED.** No package or application imports
`@qf-jarvis/aarohi-agent`, and a spec asserts the first consumer will be a deliberate decision.

**Core owns payment truth. Core owns activation truth. Payment is not activation. And
`completeCoreActiveHandoff` remains the only route into `HANDED_OFF_TO_ANISHA`.**
