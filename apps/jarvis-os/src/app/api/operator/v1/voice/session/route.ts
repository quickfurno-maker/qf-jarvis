import { RoomAgentDispatch, RoomConfiguration, TrackSource } from '@livekit/protocol';
import {
  OPERATOR_VOICE_AGENT_NAME,
  OPERATOR_VOICE_SESSION_PROTOCOL,
  operatorVoiceSessionSchema,
} from '@qf-jarvis/operator-api-contract';
import { AccessToken } from 'livekit-server-sdk';

import { requireApiOperatorSession } from '../../../../../../server/auth/dal';
import { requireSameOriginMutation } from '../../../../../../server/auth/origin/same-origin';
import { loadLiveKitOperatorConfig } from '../../../../../../server/auth/config/loader';
import {
  READ_ONLY_HEADERS,
  UNAUTHENTICATED_BODY,
} from '../../../../../../server/control-plane/route-response';

export const dynamic = 'force-dynamic';

const SESSION_TTL_SECONDS = 10 * 60;

const UNAVAILABLE_BODY = Object.freeze({
  error: 'operator-voice-unavailable',
  message: 'Jarvis voice is not connected in this environment.',
});

const INVALID_BODY = Object.freeze({
  error: 'operator-voice-session-invalid',
  message: 'This endpoint accepts no query parameters or request body.',
});

export async function POST(request: Request): Promise<Response> {
  let session;
  try {
    session = await requireApiOperatorSession();
  } catch {
    return new Response(JSON.stringify(UNAUTHENTICATED_BODY), {
      status: 401,
      headers: READ_ONLY_HEADERS,
    });
  }

  try {
    requireSameOriginMutation({
      method: request.method,
      headers: request.headers,
      mode: session.config.mode,
    });
  } catch {
    return new Response(JSON.stringify({ error: 'origin_refused' }), {
      status: 403,
      headers: READ_ONLY_HEADERS,
    });
  }

  const csrf = request.headers.get('x-qfj-csrf');
  if (!csrf || csrf !== session.csrfToken) {
    return new Response(JSON.stringify({ error: 'csrf_refused' }), {
      status: 403,
      headers: READ_ONLY_HEADERS,
    });
  }

  if (new URL(request.url).search !== '' || (await request.text()).trim() !== '') {
    return new Response(JSON.stringify(INVALID_BODY), {
      status: 400,
      headers: READ_ONLY_HEADERS,
    });
  }

  try {
    const config = loadLiveKitOperatorConfig();
    const roomName = 'qfj-operator-voice-' + crypto.randomUUID();
    const participantIdentity = 'operator-' + crypto.randomUUID();

    const token = new AccessToken(config.apiKey, config.apiSecret, {
      identity: participantIdentity,
      ttl: SESSION_TTL_SECONDS,
    });

    token.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canPublishSources: [TrackSource.MICROPHONE],
      canSubscribe: true,
      canPublishData: true,
      canUpdateOwnMetadata: false,
      roomAdmin: false,
      roomRecord: false,
      ingressAdmin: false,
    });

    token.roomConfig = new RoomConfiguration({
      maxParticipants: 2,
      emptyTimeout: 60,
      departureTimeout: 30,
      agents: [
        new RoomAgentDispatch({
          agentName: config.agentName || OPERATOR_VOICE_AGENT_NAME,
        }),
      ],
    });

    const response = operatorVoiceSessionSchema.parse({
      protocol: OPERATOR_VOICE_SESSION_PROTOCOL,
      serverUrl: config.serverUrl,
      roomName,
      participantIdentity,
      participantToken: await token.toJwt(),
      agentName: config.agentName,
      expiresInSeconds: SESSION_TTL_SECONDS,
      mode: 'READ_ONLY',
      executionAuthority: 'NONE',
      businessEffect: false,
    });

    return new Response(JSON.stringify(response), {
      status: 201,
      headers: READ_ONLY_HEADERS,
    });
  } catch {
    return new Response(JSON.stringify(UNAVAILABLE_BODY), {
      status: 503,
      headers: READ_ONLY_HEADERS,
    });
  }
}
