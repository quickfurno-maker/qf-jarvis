# ADR-0169 — LiveKit transport-only voice boundary

**Status:** Accepted  
**Date:** 2026-09-25  
**Supersedes:** the LiveKit Inference portion of ADR-0168

## Decision

Jarvis uses LiveKit only for realtime WebRTC transport, room/session lifecycle, microphone media,
and named programmatic-participant dispatch. The LiveKit worker must not instantiate or configure
speech recognition, speech synthesis, a reasoning model, turn detection, or LiveKit Inference.

Jarvis remains the single intelligence and governance authority. A future speech adapter may convert
audio to/from Jarvis, but that adapter is a separate capability and must not widen LiveKit authority.

## Production boundary

The worker receives only the LiveKit Cloud WebSocket URL, project API key/secret, and reviewed agent
dispatch name. It subscribes to microphone audio only, exposes no public port, has no Traefik route,
and owns no Core, action, communication, SIP, telephony, model-provider, or Jarvis-reasoning secret.

The Jarvis OS browser may create an authenticated, CSRF-protected short-lived LiveKit session and
publish microphone audio. The LiveKit layer does not call Jarvis Intelligence or any command API.

## Consequence

Activating this boundary proves realtime transport, microphone lifecycle, reconnection, dispatch and
containment. It does **not** by itself provide speech understanding or spoken Jarvis responses.
Those capabilities require a separately reviewed speech adapter.
