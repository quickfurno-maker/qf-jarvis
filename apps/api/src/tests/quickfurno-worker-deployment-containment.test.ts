import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (relative: string): string => readFileSync(`${ROOT}/${relative}`, 'utf8');

const compose = read('deploy/quickfurno-worker/compose.production.yml');
const dockerfile = read('deploy/quickfurno-worker/Dockerfile');
const deploy = read('deploy/quickfurno-worker/deploy.sh');
const activate = read('deploy/quickfurno-worker/activate.sh');
const disable = read('deploy/quickfurno-worker/disable.sh');
const verifyMerged = read('deploy/quickfurno-worker/verify-merged-sha.sh');
const example = read('deploy/quickfurno-worker/worker-config.example.json');
const gatewayCompose = read('deploy/quickfurno-gateway/compose.production.yml');

describe('QuickFurno production worker deployment containment', () => {
  it('is a private non-root read-only container with no public routing surface', () => {
    expect(compose).toContain("user: '10003:10002'");
    expect(compose).toContain('read_only: true');
    expect(compose).toContain('no-new-privileges:true');
    expect(compose).toContain('- ALL');
    expect(compose).toContain("traefik.enable: 'false'");
    expect(compose).not.toMatch(/^\s*ports:/m);
    expect(dockerfile).not.toMatch(/^EXPOSE\b/m);
    expect(dockerfile).toContain('USER 10003:10002');
  });

  it('shares exactly the gateway durable spool host path and no gateway secret', () => {
    const spool = '/srv/qf-jarvis/state/quickfurno-gateway-turns';
    expect(gatewayCompose).toContain(`source: ${spool}`);
    expect(compose).toContain(`source: ${spool}`);
    expect(compose).toContain('target: /var/lib/qfj-turns');
    expect(compose).not.toContain('qf-jarvis-gateway.json');
  });

  it('mounts only explicit worker evidence/credential/config/control inputs', () => {
    for (const source of [
      '/srv/qf-jarvis/secrets/qf-jarvis-whatsapp-worker.json',
      '/srv/qf-jarvis/secrets/groq-production.key',
      '/srv/qf-jarvis/seals/jf5c-production-seal.json',
      '/srv/qf-jarvis/state/quickfurno-worker-control',
    ]) {
      expect(compose).toContain(`source: ${source}`);
    }
    expect(compose).not.toContain('/var/run/docker.sock');
    expect(compose).not.toMatch(/network_mode:\s*host/);
    expect(compose).not.toMatch(/privileged:\s*true/);
  });

  it('binds the image to an exact merged SHA and builds from tracked commit bytes', () => {
    expect(compose).toContain('QFJ_WORKER_IMAGE_TAG must be the exact merged git SHA');
    expect(dockerfile).toContain('org.opencontainers.image.revision');
    expect(deploy).toContain('"$HERE/verify-merged-sha.sh" "$SHA" "$REPO_DIR"');
    expect(deploy).toContain('git -c core.autocrlf=false -c core.eol=lf');
    expect(deploy).toContain('archive --format=tar "$SHA"');
    expect(verifyMerged).toContain(`merge-base --is-ancestor "$SHA" 'origin/main^{commit}'`);
    expect(verifyMerged).toContain('fetch --prune origin');
  });

  it('deployment starts fail-closed and activation is a separate explicit action', () => {
    expect(deploy).toContain('[[ -f "$DISABLE" ]]');
    expect(deploy).not.toContain('rm -- "$DISABLE"');
    expect(activate).toContain('rm -- "$DISABLE"');
    expect(disable).toContain(': > "$DISABLE_FILE"');
    expect(compose).toContain('target: /var/run/qfj-control');
    expect(example).toContain('"killSwitchFile": "/var/run/qfj-control/DISABLE_MODEL"');
  });

  it('production example starts with knowledge disabled and still requires the mounted final seal', () => {
    expect(example).toContain('"knowledge": {');
    expect(example).toContain('"mode": "DISABLED"');
    expect(example).not.toContain('"database":');
    expect(example).not.toContain('postgres-ca.pem');
    expect(example).toContain('"sealFile": "/run/secrets/jf5c-production-seal.json"');
    expect(example).toContain('"groqCredentialFile": "/run/secrets/groq-production.key"');
  });

  it('contains no committed credential or private-key material', () => {
    const all = [compose, dockerfile, deploy, activate, disable, example].join('\n');
    expect(all).not.toMatch(/gsk_[A-Za-z0-9]{8,}/);
    expect(all).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY/);
    expect(all).not.toMatch(/postgresql:\/\/[^\s"]+:[^\s"]+@/);
  });
});
