# ADR-0161 — Governed memory, Core data tools, knowledge freshness and JAO action registry

**Status:** Accepted for engineering foundation only. No production activation is authorized.

**Date:** 2026-09-23.

## Context

Jarvis already has four strong boundaries that must remain intact:

1. QuickFurno Core is business authority.
2. Governed RAG is reference knowledge, never authority.
3. JAO is default-off and may not autonomously acquire business-effect authority.
4. Riya durable persistence remains blocked until the owner approves classification, purpose, retention and erasure behavior.

The next capability phase must add usefulness without creating alternate sources of truth or silently weakening those gates.

## Decision

### 1. Governed long-term memory

Add a policy-only memory foundation with three explicit classes:

- `CONVERSATION_EPHEMERAL`
- `DURABLE_PREFERENCE`
- `CORE_AUTHORITY_REFERENCE`

Durable preferences are structurally supported but default disabled. Enabling them requires an exact owner approval reference, retention policy reference, erasure policy reference and bounded retention period.

`CORE_AUTHORITY_REFERENCE` is never writable into Jarvis memory. Business authority remains live in Core.

The foundation stores only structured references. It contains no database adapter, model, transport or background writer.

### 2. Live Core data tools

Add a read-only registry over existing Core-owned ports:

- service availability read;
- Riya intake/contact/consent-state read;
- submission lookup for idempotent recovery.

The mutating intake `submit` method is deliberately absent from this registry.

Every raw result remains `UNTRUSTED_UNTIL_PARSED` by its canonical Core contract parser. The registry invents no HTTP endpoint, credential, database query or cache.

### 3. Knowledge freshness

Add deterministic source-fingerprint comparison using exact:

- source reference;
- source revision;
- content digest;
- owner reference;
- production-approval state.

Freshness may classify a source as `UNCHANGED`, `CHANGED`, `NEW` or `MISSING`.

A change may become only `ELIGIBLE_FOR_STAGING_BUILD` after all observed sources are approved and evaluation has passed. The freshness layer cannot ingest, seal, activate or publish a knowledge release.

Source disappearance is a blocker, never an implicit corpus shrink.

### 4. JAO action registry

Add a proposal-only registry describing bounded action metadata:

- exact action/version identity;
- risk class;
- effect class;
- allowed agent scopes;
- required authority reference;
- approval policy;
- idempotency policy;
- rollback policy;
- enabled flag.

The engineering registry ships every action disabled.

Even a separately reviewed enabled action may become only `ELIGIBLE_FOR_PROPOSAL`. This is not authorization, execution, delivery or provider effect. Real execution remains downstream of Core/approval/Temporal boundaries.

## Initial engineering action vocabulary

The first disabled definitions are:

- `schedule_callback@1`
- `request_human_takeover@1`
- `start_governed_followup@1`

These names reserve no production authority and do not prove a matching QuickFurno executor exists.

## Containment

This phase adds no:

- managed database migration;
- production memory table;
- Core write adapter;
- Meta/provider credential;
- provider send;
- knowledge activation;
- JF-5C change;
- production worker activation;
- autonomous JAO executor.

## Release consequence

Because this is new Jarvis code after the previously merged release candidate, any future production release containing it requires a new exact-SHA certification chain.

Until the Riya lifecycle owner decision exists, durable long-term memory must remain disabled.
