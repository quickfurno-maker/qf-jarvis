# QF Jarvis

QF Jarvis is the intelligence, recommendation, coordination, and decision-support system for the QuickFurno ecosystem.

## Permanent Architecture Boundary

- QuickFurno Core = source of truth, policy, authorization, and operational state
- QF Jarvis = intelligence, reasoning, recommendations, coordination, and prioritization
- n8n = approved execution fabric
- External Providers = WhatsApp, SMS, Email, Ads, CRM, Voice, and other delivery channels

## Core Rule

Jarvis recommends.
QuickFurno authorizes.
n8n executes.
Providers deliver.
Results return to QuickFurno Core.

This repository is being rebuilt from zero using a contract-first, event-driven, modular architecture designed for long-term compatibility with QuickFurno.
