# Jarvis LiveKit operator voice transport

This package deploys the private LiveKit participant used by Jarvis OS operator voice.

LiveKit is deliberately used as realtime WebRTC transport only. The worker has no STT, TTS,
LLM, LiveKit Inference model, Jarvis reasoning credential, QuickFurno Core credential,
operator-command credential, Action Kernel, SIP/telephony configuration, or outbound-call authority.

The worker joins the named LiveKit room, subscribes only to operator microphone audio, and keeps
the transport session alive until the operator leaves. Speech understanding and speech generation
are separate Jarvis capabilities and are not activated by this deployment.

## Required secret

Provision `/srv/qf-jarvis/secrets/qf-jarvis-livekit-voice-agent.json` as mode `0400` or `0600`,
owned by `10004:10004`.

Do not commit or paste the secret.

The JSON protocol is `qfj.livekit.operator-voice-transport.v1` and contains only the LiveKit Cloud
`wss://...livekit.cloud` URL, project API key/secret, and the reviewed agent dispatch name.

## Deployment

Only a full SHA contained in `origin/main` is accepted:

    /srv/qf-jarvis/repo/deploy/livekit-voice-agent/deploy.sh <sha>

The resulting container has no public port and no Traefik route.
