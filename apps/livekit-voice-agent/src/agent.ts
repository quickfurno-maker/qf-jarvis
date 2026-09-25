import { AutoSubscribe, type JobContext, ServerOptions, cli, defineAgent } from '@livekit/agents';
import { RoomEvent, type RemoteParticipant } from '@livekit/rtc-node';
import { OPERATOR_VOICE_AGENT_NAME } from '@qf-jarvis/operator-api-contract';
import { fileURLToPath } from 'node:url';

import { loadVoiceAgentConfig } from './config.js';

export function createVoiceTransport() {
  return defineAgent({
    entry: async (ctx: JobContext) => {
      const operatorIdentity = { current: undefined as string | undefined };
      const operatorLeft = new Promise<void>((resolve) => {
        ctx.room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
          if (participant.identity === operatorIdentity.current) resolve();
        });
      });

      // LiveKit is transport only. Subscribe to operator microphone audio without
      // instantiating any speech, reasoning, turn-handling, tool, or inference pipeline.
      await ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY);
      const operator = await ctx.waitForParticipant();
      operatorIdentity.current = operator.identity;

      await operatorLeft;
    },
  });
}

// Backward-compatible export name for the existing package boundary.
export const createVoiceAgent = createVoiceTransport;

const config = loadVoiceAgentConfig();

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  cli.runApp(
    new ServerOptions({
      agent: fileURLToPath(import.meta.url),
      agentName: config.livekit.agentName || OPERATOR_VOICE_AGENT_NAME,
      wsURL: config.livekit.wsUrl,
      apiKey: config.livekit.apiKey,
      apiSecret: config.livekit.apiSecret,
      production: true,
    }),
  );
}

export default createVoiceTransport();
