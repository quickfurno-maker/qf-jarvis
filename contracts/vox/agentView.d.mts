export declare const VOX_JARVIS_CONTRACT: 'qf.vox.agent.view.v1';
export declare const VOX_AGENT_CHANNELS: Readonly<{
  AAROHI: 'ACQUISITION';
  ANISHA: 'VENDOR_SERVICE';
}>;
export declare function signAgentView(
  event: Readonly<{
    schema: string;
    iss: string;
    aud: string;
    agent: 'AAROHI' | 'ANISHA';
    channel: 'ACQUISITION' | 'VENDOR_SERVICE';
    subjectType: 'prospect' | 'vendor';
    subjectId: string;
    jti: string;
    revision: number;
    iat: number;
    exp: number;
    memoryStatus: string;
    humanTakeover: boolean;
    lastEvent?: string;
  }>,
  secret: string,
): string;
export declare function verifyAgentView(
  token: string,
  secret: string,
  nowSecs?: number,
): Readonly<{
  agent: string;
  channel: string;
  subjectType: string;
  subjectId: string;
  jti: string;
  revision: number;
  expiresAt: number;
  replayCheckRequired: boolean;
}>;
