'use client';

import {
  OPERATOR_VOICE_INTELLIGENCE_RPC,
  operatorVoiceRpcRequestSchema,
  operatorVoiceRpcResponseSchema,
  parseOperatorVoiceSession,
} from '@qf-jarvis/operator-api-contract';
import { Room, RoomEvent, Track, type RemoteTrack, type RpcInvocationData } from 'livekit-client';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export type VoiceState =
  'DISCONNECTED' | 'CONNECTING' | 'WAITING_FOR_AGENT' | 'CONNECTED' | 'RECONNECTING' | 'ERROR';

interface VoiceSessionContextValue {
  readonly state: VoiceState;
  readonly muted: boolean;
  readonly error: string | undefined;
  readonly start: () => Promise<void>;
  readonly stop: () => Promise<void>;
  readonly toggleMute: () => Promise<void>;
}

const VoiceSessionContext = createContext<VoiceSessionContextValue | undefined>(undefined);

function operationalAnswer(body: unknown): string {
  const parsed = operatorVoiceRpcResponseSchema.parse({
    ...(typeof body === 'object' && body !== null && !Array.isArray(body) ? body : {}),
    executionAuthority: 'NONE',
    businessEffect: false,
  });
  return JSON.stringify(parsed);
}

export function VoiceSessionProvider({
  children,
  csrfToken,
}: {
  readonly children: ReactNode;
  readonly csrfToken: string;
}) {
  const roomRef = useRef<Room | undefined>(undefined);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [state, setState] = useState<VoiceState>('DISCONNECTED');
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string>();

  const stop = async (): Promise<void> => {
    const room = roomRef.current;
    roomRef.current = undefined;
    if (room !== undefined) {
      try {
        await room.localParticipant.setMicrophoneEnabled(false);
      } finally {
        await room.disconnect();
      }
    }
    setMuted(false);
    setState('DISCONNECTED');
  };

  useEffect(() => {
    return () => {
      void roomRef.current?.disconnect();
      roomRef.current = undefined;
    };
  }, []);

  const start = async (): Promise<void> => {
    if (
      state === 'CONNECTING' ||
      state === 'WAITING_FOR_AGENT' ||
      state === 'CONNECTED' ||
      state === 'RECONNECTING'
    )
      return;
    setError(undefined);
    setState('CONNECTING');

    try {
      const sessionResponse = await globalThis.fetch('/api/operator/v1/voice/session', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          'x-qfj-csrf': csrfToken,
        },
      });
      if (!sessionResponse.ok) {
        throw new TypeError(
          sessionResponse.status === 503
            ? 'LiveKit is not provisioned for this environment yet.'
            : 'Voice session could not be created.',
        );
      }

      const session = parseOperatorVoiceSession(await sessionResponse.json());
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });

      room.registerRpcMethod(
        OPERATOR_VOICE_INTELLIGENCE_RPC,
        async (data: RpcInvocationData): Promise<string> => {
          const caller = room.remoteParticipants.get(data.callerIdentity);
          if (caller?.isAgent !== true) throw new TypeError('voice-rpc-caller-not-agent');

          const request = operatorVoiceRpcRequestSchema.parse(JSON.parse(data.payload));
          const response = await globalThis.fetch('/api/operator/v1/intelligence', {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(request),
          });
          if (!response.ok) throw new TypeError('voice-intelligence-unavailable');
          return operationalAnswer(await response.json());
        },
      );

      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Audio && audioRef.current !== null) {
          track.attach(audioRef.current);
          void audioRef.current.play().catch(() => undefined);
        }
      });
      const syncAgentState = (): void => {
        const hasAgent = [...room.remoteParticipants.values()].some(
          (participant) => participant.isAgent,
        );
        setState(hasAgent ? 'CONNECTED' : 'WAITING_FOR_AGENT');
      };

      room.on(RoomEvent.ParticipantConnected, (participant) => {
        if (participant.isAgent) setState('CONNECTED');
      });
      room.on(RoomEvent.ParticipantDisconnected, (participant) => {
        if (participant.isAgent) setState('WAITING_FOR_AGENT');
      });
      room.on(RoomEvent.Reconnecting, () => {
        setState('RECONNECTING');
      });
      room.on(RoomEvent.Reconnected, syncAgentState);
      room.on(RoomEvent.Disconnected, () => {
        if (roomRef.current === room) roomRef.current = undefined;
        setMuted(false);
        setState('DISCONNECTED');
      });

      // Assign before the async connect/microphone boundary so any failure path can always
      // disconnect the exact room and release microphone/media resources.
      roomRef.current = room;
      await room.connect(session.serverUrl, session.participantToken, { autoSubscribe: true });
      await room.localParticipant.setMicrophoneEnabled(true);

      syncAgentState();
    } catch (cause) {
      await roomRef.current?.disconnect();
      roomRef.current = undefined;
      setState('ERROR');
      setError(cause instanceof Error ? cause.message : 'Voice connection failed.');
    }
  };

  const toggleMute = async (): Promise<void> => {
    const room = roomRef.current;
    if (room === undefined) return;
    const nextMuted = !muted;
    await room.localParticipant.setMicrophoneEnabled(!nextMuted);
    setMuted(nextMuted);
  };

  const value: VoiceSessionContextValue = {
    state,
    muted,
    error,
    start,
    stop,
    toggleMute,
  };

  return (
    <VoiceSessionContext.Provider value={value}>
      <audio ref={audioRef} autoPlay className="hidden" />
      {children}
    </VoiceSessionContext.Provider>
  );
}

export function useVoiceSession(): VoiceSessionContextValue {
  const value = useContext(VoiceSessionContext);
  if (value === undefined) throw new TypeError('voice-session-provider-missing');
  return value;
}
