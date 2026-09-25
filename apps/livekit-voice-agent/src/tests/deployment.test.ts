import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (path: string): string => readFileSync(REPO + path, 'utf8');
const dockerfile = read('deploy/livekit-voice-agent/Dockerfile');
const compose = read('deploy/livekit-voice-agent/compose.production.yml');
const deploy = read('deploy/livekit-voice-agent/deploy.sh');
const osVoice = read('deploy/jarvis-os/compose.voice.yml');

describe('LiveKit voice production deployment containment', () => {
  it('builds only the voice app and its read-only operator contract', () => {
    expect(dockerfile).toContain('apps/livekit-voice-agent');
    expect(dockerfile).toContain('packages/operator-api-contract');
    for (const forbidden of [
      'operator-client-core',
      'action-kernel',
      'execution-dispatch',
      'communication-authorization',
      'quickfurno-gateway',
      'apps/api',
      'apps/worker',
    ]) {
      expect(dockerfile, forbidden).not.toContain(forbidden);
    }
  });

  it('runs privately with no ingress, host port, privilege or writable root filesystem', () => {
    expect(dockerfile).toContain('groupadd --gid 10004 jarvisvoice');
    expect(dockerfile).toContain('useradd --uid 10004 --gid 10004');
    expect(dockerfile).not.toContain('groupadd --gid 10004 voice');
    expect(compose).toContain("traefik.enable: 'false'");
    expect(compose).toContain('read_only: true');
    expect(compose).toContain('no-new-privileges:true');
    expect(compose).toMatch(/cap_drop:\s*\n\s*- ALL/u);
    expect(compose).not.toMatch(/^\s*ports:/mu);
    expect(compose).not.toContain('privileged: true');
  });

  it('mounts one private voice config and no Core or business-provider secret', () => {
    expect(compose).toContain('/srv/qf-jarvis/secrets/qf-jarvis-livekit-voice-agent.json');
    expect(compose).toContain('read_only: true');
    for (const forbidden of [
      'core-read',
      'core-command',
      'quickfurno-signing',
      'groq-production',
      'whatsapp',
      'sip',
      'telephony',
    ]) {
      expect(compose.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  it('requires a merged SHA and a private correctly-owned config before deployment', () => {
    expect(deploy).toContain('verify-merged-sha.sh');
    expect(deploy).toContain('expected 400 or 600');
    expect(deploy).toContain('expected 10004:10004');
    expect(deploy).not.toContain('docker login');
  });

  it('keeps Jarvis OS LiveKit configuration opt-in and read-only', () => {
    expect(osVoice).toContain('QFJ_JOS_LIVEKIT_CONFIG_FILE');
    expect(osVoice).toContain('/srv/qf-jarvis/secrets/qf-jarvis-os-livekit.json');
    expect(osVoice).toContain('read_only: true');
    expect(osVoice).not.toMatch(/^\s*ports:/mu);
  });

  it('requires the matching private voice-agent release before OS voice activation', () => {
    const activate = read('deploy/jarvis-os/activate.sh');
    expect(activate).toContain('qf-jarvis-livekit-voice-agent must be running');
    expect(activate).toContain('VOICE_AGENT_REVISION');
    expect(activate).toContain('does not match Jarvis OS release');
  });
});
