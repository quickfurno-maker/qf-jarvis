import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir)
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : [path];
    })
    .filter((path) => path.endsWith('.ts') && !path.endsWith('.test.ts'));
}

describe('LiveKit operator voice containment', () => {
  it('contains no Core, execution, operator-command, SIP, telephony or outbound-business-call seam', () => {
    const code = files(ROOT)
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');

    for (const forbidden of [
      '@qf-jarvis/operator-client-core',
      '@qf-jarvis/action-kernel',
      '@qf-jarvis/core-decision',
      '@qf-jarvis/execution-dispatch',
      '@qf-jarvis/communication-authorization',
      'APPROVAL_DECIDE',
      'CONVERSATION_TAKEOVER',
      'CONVERSATION_PAUSE_AI',
      'CONVERSATION_RESUME_AI',
      'outbound-voice-call',
      'RoomServiceClient',
      'Sip',
      'SIP',
      'telephony',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('forwards operational questions only to the reviewed read-only RPC', () => {
    const code = readFileSync(join(ROOT, 'agent.ts'), 'utf8');
    expect(code).toContain('OPERATOR_VOICE_INTELLIGENCE_RPC');
    expect(code).toContain('execution ability');
    expect(code).toContain('voice is read-only');
  });

  it('reads only a file-path environment variable, never LiveKit secret values from ambient env', () => {
    const code = files(ROOT)
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    expect(code).toContain('QFJ_LIVEKIT_VOICE_AGENT_CONFIG_FILE');
    const envReads = code.match(/process\.env\[/gu) ?? [];
    expect(envReads).toHaveLength(1);
    for (const forbidden of ['LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'LIVEKIT_URL']) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('ships as a private outbound-only hardened worker', () => {
    const dockerfile = readFileSync(
      join(REPO_ROOT, 'deploy', 'livekit-voice-agent', 'Dockerfile'),
      'utf8',
    );
    const compose = readFileSync(
      join(REPO_ROOT, 'deploy', 'livekit-voice-agent', 'compose.production.yml'),
      'utf8',
    );
    expect(dockerfile).toContain('USER 10004:10004');
    expect(dockerfile).toContain('apps/livekit-voice-agent/dist/agent.js');
    expect(compose).toContain("user: '10004:10004'");
    expect(compose).toContain('read_only: true');
    expect(compose).toContain('no-new-privileges:true');
    expect(compose).toContain('cap_drop:');
    expect(compose).toContain('- ALL');
    expect(compose).toContain('read_only: true');
    expect(compose).toContain("traefik.enable: 'false'");
    expect(compose).not.toMatch(/^\s*ports:/mu);
    expect(compose).toContain('/run/secrets/qf-jarvis-livekit-voice-agent.json');
  });
});
