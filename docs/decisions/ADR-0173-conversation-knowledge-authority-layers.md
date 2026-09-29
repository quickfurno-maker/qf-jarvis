# ADR-0173 — Conversation, knowledge, live-truth and training authority layers

**Status:** Accepted / locked
**Date:** 2026-09-29
**Owner decision:** QuickFurno / QF Jarvis

## Decision

Riya, Anisha and Aarohi use four deliberately separate information layers. They may cooperate in one
turn, but they may not be collapsed into one corpus or treated as interchangeable sources of truth.

1. **Conversation intelligence — Luna/default conversation model.** Natural conversation, greetings,
   clarification, tone, continuity and ordinary language generation begin with the conversation model.
   A greeting or conversational follow-up does not trigger retrieval merely because a knowledge index
   exists.
2. **Approved QuickFurno knowledge — governed RAG.** Stable, reviewed QuickFurno material such as
   approved FAQs, service explanations, onboarding guidance, matching explanations and durable policy
   references may be retrieved when the turn needs business-specific knowledge.
3. **Current QuickFurno truth — Core/live tools.** Prices, packages, credits, payment state, vendor or
   lead state, assignment state, consent, eligibility, availability and other changing operational facts
   come from QuickFurno Core or a governed live capability. RAG and model memory are never substitutes.

4. **Training/evaluation data — offline only.** Human Gold, synthetic conversations, benchmarks,
   correction corpora and other model-development datasets are not production knowledge. They may be
   used offline for evaluation, regression, fine-tuning or later model improvement under their existing
   governance, but production customer turns do not retrieve from them.

## Routing rule

The normal path is:

`message → agent/intent decision → conversation model → optional approved RAG or live Core context → model reply → Jarvis governance → QuickFurno authorization`

A router such as TypeSafe Jev may recommend the agent, intent, retrieval need and model tier. It does
not become a knowledge authority and cannot convert training data, repository text or stale content into
business truth. Jarvis policy remains authoritative for the allowed route.

Difficult reasoning may be escalated to the governed higher-reasoning model tier (Sol), but changing the
model does not change the authority of the information supplied to it.

## What is approved for RAG

Repository presence is **not approval**. A production knowledge record must enter through the governed
knowledge lifecycle with source/revision, human approval, effective window, classification and
agent/purpose permissions. Riya uses CLIENT/CLIENT_RESPONSE scope, Anisha VENDOR/VENDOR_RESPONSE and
Aarohi PROSPECT/PROSPECT_RESPONSE.

The QuickFurno repository contains useful candidate material, including current homeowner/vendor FAQs,
terms, privacy and durable service explanations. It also contains legacy, demo and superseded copy.
Therefore no implementation may bulk-index a repository, directory or historical dataset as production
knowledge. Candidate material must be curated, deduplicated, reviewed and released as an immutable
approved knowledge revision.

## Explicit exclusions

- Do not use Riya Human Gold or AI-synthetic corpora as runtime business knowledge.
- Do not use old/demo package prices, testimonials or planned features as current facts.
- Do not copy live Core values into RAG to make retrieval easier.
- Do not force retrieval on every conversational turn.
- Do not let a provider, Jev, Mastra or an agent choose its own authority source.
- Do not silently fall back from unavailable live truth to model memory.

## Existing enforcement

ADR-0145 and `training-offline-containment.test.ts` structurally prevent production runtime packages
from depending on the training/data-generation lane. ADR-0158/0159 define the shared governed hybrid
retrieval plane. ADR-0164 keeps production knowledge explicitly DISABLED until an approved corpus and
matching certification exist. The current empty production knowledge pack therefore remains correct
until the first curated QuickFurno knowledge release is reviewed and sealed.

## Activation consequence

The next knowledge activation is not “use all existing datasets.” It is: curate approved QuickFurno
business knowledge → exclude stale/demo/training material → keep volatile facts in Core → build the
immutable knowledge release → evaluate retrieval → certify the exact knowledge revision → activate
HYBRID under the existing production seal process.
