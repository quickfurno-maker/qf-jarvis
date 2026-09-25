- **Status:** Accepted
- **Date:** 2026-09-25
- **Owners:** QF Jarvis
- **Scope:** Jarvis operator/founder voice interface using LiveKit

## Context

ADR-0167 fixed the authority substrate for future voice: voice is another client of proactive Jarvis intelligence and the operator API, not a privileged execution channel.

Two different meanings of “voice” must remain separate:

1. **Operator voice** — the authenticated founder/operator speaks to Jarvis about system state.
2. **Business voice** — a customer/vendor telephone call, which is a governed communication action with consent, quiet-hours, script and explicit human-approval requirements.

Conflating them would allow a convenient operator interface to become an undeclared telephony provider path.

## Decision

LiveKit is adopted as the realtime media transport for **operator voice**.

The first production-capable voice architecture is:

**authenticated Jarvis OS browser → LiveKit room → Jarvis voice agent → LiveKit RPC back to the authenticated browser → existing `/api/operator/v1/intelligence` read-only contract**

LiveKit does not become a source of business truth or business authority.

### Why the browser owns the Jarvis intelligence call

The LiveKit voice-agent process does not receive the operator's Jarvis OS session, QuickFurno Core credentials, the operator-command client, the Action Kernel, execution transports, communication authorization, SIP, or telephony capabilities.

Before every completed operator turn is sent to the LLM, the voice agent invokes one fixed LiveKit RPC method on the authenticated browser participant. The browser validates that the RPC caller is a LiveKit Agent, parses the bounded question, and calls the existing same-origin authenticated Jarvis Intelligence endpoint. The validated result is injected into the current turn as governed evidence before speech generation. This deterministic pre-response hook means the model cannot simply forget to request current operational state.

This keeps the voice worker outside the Jarvis authority and business-data credential boundary.

## Media and session containment

Jarvis OS mints a short-lived, single-room LiveKit participant token only after an authenticated operator session.

The browser participant:

- has an opaque random room name and identity; no customer/vendor/operator PII is placed in the LiveKit identity;
- may publish **microphone only**;
- may subscribe to the agent audio;
- may publish data needed for RPC;
- receives no room-admin, recording, ingress, SIP, or telephony grant;
- obtains microphone permission only after an explicit **Start voice** user gesture.

The browser CSP permits outbound realtime connections only to the reviewed LiveKit Cloud origin. Camera, display capture, geolocation, payment, USB and other sensitive device capabilities remain denied.

## Speech architecture

The operator voice agent uses an **STT → LLM → TTS** pipeline through LiveKit Inference.

This is chosen over an opaque speech-to-speech path because the text boundary is easier to evaluate, govern and correlate. Every completed operator turn is enriched through the fixed Jarvis Intelligence RPC before the LLM answers, and the agent is instructed to use only that governed evidence for current QuickFurno/Jarvis facts. On session start, the same read-only RPC may fetch the Now Brief so Jarvis can proactively surface the most important current attention item.

The voice agent itself carries:

- `executionAuthority: NONE`;
- no Core client;
- no operator-command client;
- no execution dispatcher;
- no communication-authorization runtime;
- no SIP or telephony client;
- no business-send capability.

## Mutation boundary

This phase is **read-only voice**.

If the operator asks Jarvis Voice to approve, reject, pause, resume, enable, disable, send, call, execute, or change production state, the voice agent explains that the action must be completed through the governed Jarvis OS surface.

A future voice-command phase may prepare a command for explicit confirmation, but it must reuse the existing operator-command contract and Core authorization rules. Voice never gains a second mutation API.

## Outbound business calling

This ADR authorizes **no customer/vendor call**.

Outbound business voice remains governed by the existing communication model:

- explicit consent and eligibility from QuickFurno Core;
- approved voice script;
- quiet-hours and attempt-limit enforcement;
- explicit human approval for each production call initially;
- Core Automation / QF Communications Runtime execution;
- provider-reported outcome returned to Core.

LiveKit operator voice cannot be used to bypass that model.

## Credentials and activation

LiveKit API credentials are file-backed secrets. Environment variables may contain only the path to the secret file.

The repository may ship the voice client, token endpoint and voice-agent composition while the capability remains `NOT_CONNECTED`. It becomes runtime-available only after:

1. a reviewed LiveKit project is provisioned;
2. credentials are mounted as protected files;
3. the voice agent is deployed;
4. browser/agent connectivity and interruption behavior pass live smoke;
5. runtime observation proves the configured voice path is reachable.

No credentials are committed, pasted into code, or placed in client-visible environment variables.

## Recording, wake word and always-listening posture

Recording/egress is not granted by the session token and is not part of this phase.

A future wake-word/always-listening feature must make its own privacy decision covering local activation, microphone indicators, retention, accidental activation and a hard physical/software mute. LiveKit transport readiness does not by itself authorize background microphone capture.

## Result

Jarvis gains a realtime, interruptible operator voice interface without weakening its authority model. The same proactive intelligence is now consumable by web, future mobile and LiveKit voice clients, while all business mutations and outbound communications remain behind their existing governed boundaries.
