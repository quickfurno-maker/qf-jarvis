# ADR-0172 — Phase 1 OpenAI provider adapter behind Model Gateway

**Status:** Accepted
**Date:** 2026-09-29

## Decision

Phase 1 adds OpenAI as a hosted inference provider behind the existing provider-neutral
`@qf-jarvis/model-gateway`. It does not redesign Jarvis, the QuickFurno bridge, Core, JAO,
WhatsApp ownership, agent routing, memory/RAG, or the Riya/Anisha/Aarohi business contracts.

The adapter uses the fixed official OpenAI Responses API endpoint. Credentials are injected through a
redacting holder, never read from environment variables by the package, and never exposed in model
results, errors, logs, or serialization.

Every request is non-streaming and inference-only. The adapter performs one bounded HTTP request,
follows no redirects, performs no retry or sleep, sets `store: false`, and exposes no tool, web-search,
file-search, MCP, database, Core, or JAO capability.

Structured requests use strict JSON Schema through the Responses API `text.format` contract. The
gateway remains responsible for provider-neutral validation and provenance. Provider output is
decoded locally; reasoning items are not surfaced as the reply text and malformed/refusal outcomes
fail closed.

## Authority boundary

OpenAI may generate or structure an answer only. It gains no authority to mutate QuickFurno state,
confirm business truth, execute an action, change agent assignment, bypass JEV, bypass the Action
Kernel, or bypass any production release/certification gate.

QuickFurno Core remains business truth and JAO remains governed execution authority.

## Activation

This ADR authorizes the adapter foundation only. It does not activate OpenAI in production and does
not modify the current QuickFurno bridge or production worker composition.

Production use requires a separately mounted OpenAI credential, explicit provider/model composition,
provider-specific live evaluation/certification, a fresh production seal for the exact release, and
normal disabled-first deployment/rollback controls. An existing Groq certification or seal cannot be
reused for an OpenAI model.

## Phase boundary

Phase 1 is complete only when the adapter and containment tests are merged cleanly. Switching
Riya, Anisha, and Aarohi to OpenAI is a later activation step on top of this adapter, without changing
their Core/JAO/bridge authority path. Jarvis/Sol supervisory intelligence is intentionally deferred
until the three agents are operating reliably on the preserved architecture.
