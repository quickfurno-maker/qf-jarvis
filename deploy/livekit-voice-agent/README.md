# Jarvis LiveKit operator voice deployment

This package deploys the private LiveKit agent used by Jarvis OS operator voice.

It is intentionally separate from Jarvis OS and from every QuickFurno business worker.

## Authority

The voice agent has LiveKit Cloud credentials and LiveKit Inference model configuration only. It has no QuickFurno Core credential, no operator-command credential, no Action Kernel or execution transport, no SIP/telephony configuration, and no customer/vendor outbound-call capability.

Operational questions are forwarded by LiveKit RPC to the authenticated Jarvis OS browser, which uses the existing read-only Jarvis Intelligence endpoint.

## Required secret

Provision `/srv/qf-jarvis/secrets/qf-jarvis-livekit-voice-agent.json` as mode `0400` or `0600`, owned by `10004:10004`.

Do not commit or paste the secret.

The JSON protocol is `qfj.livekit.operator-voice-agent.v1` and contains the LiveKit Cloud `wss://...livekit.cloud` URL, a project API key/secret, and reviewed STT/LLM/TTS model references.

## Deployment

Only a full SHA contained in `origin/main` is accepted:

    /srv/qf-jarvis/repo/deploy/livekit-voice-agent/deploy.sh <sha>

The resulting container has no public port and no Traefik route.
