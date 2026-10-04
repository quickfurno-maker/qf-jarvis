import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (relative: string): string => readFileSync(`${ROOT}/${relative}`, 'utf8');

const compose = read('deploy/quickfurno-worker/compose.production.yml');
const openaiCompose = read('deploy/quickfurno-worker/compose.openai.production.yml');
const openaiExample = read('deploy/quickfurno-worker/worker-config.openai.example.json');
const openaiLaunch = read('deploy/quickfurno-worker/launch-openai.sh');
const openaiKeyInstaller = read('deploy/quickfurno-worker/install-openai-key.sh');
const dockerfile = read('deploy/quickfurno-worker/Dockerfile');
const deploy = read('deploy/quickfurno-worker/deploy.sh');
const activate = read('deploy/quickfurno-worker/activate.sh');
const disable = read('deploy/quickfurno-worker/disable.sh');
const verifyMerged = read('deploy/quickfurno-worker/verify-merged-sha.sh');
const example = read('deploy/quickfurno-worker/worker-config.example.json');
const jevCompose = read('deploy/quickfurno-worker/compose.jev.yml');
const jevExample = read('deploy/quickfurno-worker/worker-config.jev-shadow.example.json');
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

  it('uses PostgreSQL for durable turns and no longer mounts a host spool', () => {
    expect(gatewayCompose).toContain('QFJ_GATEWAY_TURN_STORE: POSTGRES');
    expect(gatewayCompose).toContain('QFJ_GATEWAY_DATABASE_CONFIG_FILE');
    expect(gatewayCompose).toContain('target: /run/secrets/postgres-ca.pem');
    expect(compose).toContain('target: /run/secrets/postgres-ca.pem');
    expect(gatewayCompose).not.toContain('/var/lib/qfj-turns');
    expect(compose).not.toContain('/var/lib/qfj-turns');
    expect(compose).not.toContain('quickfurno-gateway-turns');
    expect(compose).not.toContain('qf-jarvis-gateway.json');
  });

  it('does not create or repair a legacy host spool before worker startup', () => {
    expect(deploy).not.toContain('for spool_dir in pending processing completed failed');
    expect(deploy).not.toContain('chown 10002:10002 "$SPOOL/$spool_dir"');
    expect(deploy).not.toContain('chmod 0770 "$SPOOL/$spool_dir"');
    expect(deploy).toContain('required_files=("$CONFIG" "$SIGNING" "$CA")');
    expect(deploy).toContain('prove "legacy turn spool absent"');
    expect(deploy).toContain('prove "postgres CA source"');
  });

  it('mounts only explicit worker evidence/credential/config/control inputs', () => {
    for (const source of [
      '/srv/qf-jarvis/secrets/qf-jarvis-whatsapp-worker.json',
      '/srv/qf-jarvis/secrets/groq-production.key',
      '/srv/qf-jarvis/seals/jf5c-production-seal.json',
      '/srv/qf-jarvis/state/quickfurno-worker-control',
      '/srv/qf-jarvis/secrets/postgres-ca.pem',
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

  it('production example keeps knowledge disabled while PostgreSQL owns durable turns', () => {
    expect(example).toContain('"knowledge": {');
    expect(example).toContain('"mode": "DISABLED"');
    expect(example).toContain('"database": {');
    expect(example).toContain('"caFile": "/run/secrets/postgres-ca.pem"');
    expect(example).toContain('"turnStore": {');
    expect(example).toContain('"mode": "POSTGRES"');
    expect(example).not.toContain('"spoolDirectory"');
    expect(example).toContain('"sealFile": "/run/secrets/jf5c-production-seal.json"');
    expect(example).toContain('"groqCredentialFile": "/run/secrets/groq-production.key"');
  });

  it('has a separate least-privilege OpenAI deployment with no Groq secret mounted', () => {
    expect(openaiCompose).toContain('source: /srv/qf-jarvis/secrets/openai-production.key');
    expect(openaiCompose).toContain('target: /run/secrets/openai-production.key');
    expect(openaiCompose).toContain('source: /srv/qf-jarvis/seals/openai-v1-production-seal.json');
    expect(openaiCompose).not.toContain('groq-production.key');
    expect(openaiCompose).not.toContain('jf5c-production-seal.json');
    expect(openaiCompose).toContain('target: /run/secrets/postgres-ca.pem');
    expect(openaiCompose).not.toContain('/var/lib/qfj-turns');
    expect(openaiCompose).not.toContain('quickfurno-gateway-turns');
    expect(openaiCompose).toContain("user: '10003:10002'");
    expect(openaiCompose).toContain('read_only: true');
    expect(openaiCompose).toContain('no-new-privileges:true');
    expect(openaiCompose).not.toMatch(/^\s*ports:/m);
  });

  it('defines a launch-ready OpenAI config with the same 200/50/150 capacity envelope', () => {
    expect(openaiExample).toContain('"sealFile": "/run/secrets/openai-v1-production-seal.json"');
    expect(openaiExample).toContain('"credentialFile": "/run/secrets/openai-production.key"');
    expect(openaiExample).toContain('"credentialReference": "openai.qfj.production.v1"');
    expect(openaiExample).toContain('"globalMaxConcurrentTurns": 200');
    expect(openaiExample).toContain('"maxConcurrent": 50');
    expect(openaiExample).toContain('"maxQueue": 150');
    expect(openaiExample).not.toContain('groqCredentialFile');
  });

  it('launches OpenAI only after six-call smoke, exact seal, disabled deploy and READY proof', () => {
    expect(openaiLaunch).toContain('run-openai-launch-smoke.js');
    expect(openaiLaunch).toContain("node -e '");
    expect(openaiLaunch).toContain('config.openai={');
    expect(openaiLaunch).toContain('QFJ_WORKER_PROVIDER_MODE=OPENAI_LUNA_SOL');
    expect(openaiLaunch).toContain('QFJ_WORKER_SKIP_BUILD=1');
    expect(openaiLaunch).toContain('providerMode=OPENAI_LUNA_SOL');
    expect(openaiLaunch).toContain('approvals=6');
    expect(openaiLaunch.indexOf('"$HERE/disable.sh"')).toBeLessThan(
      openaiLaunch.indexOf('"$HERE/activate.sh"'),
    );
    expect(openaiKeyInstaller).toContain('read -r -s KEY');
    expect(openaiKeyInstaller).toContain('-m 0400');
    expect(openaiKeyInstaller).not.toContain('echo "$KEY"');
  });

  it('keeps TypeSafe Jev opt-in, secret-mounted, and shadow-only at deployment', () => {
    expect(example).toContain('"decisionIntelligence": {');
    expect(example).toContain('"mode": "DISABLED"');
    expect(compose).not.toContain('typesafe-jev-production.key');
    expect(jevCompose).toContain('source: /srv/qf-jarvis/secrets/typesafe-jev-production.key');
    expect(jevCompose).toContain('target: /run/secrets/typesafe-jev-production.key');
    expect(jevExample).toContain('"mode": "SHADOW"');
    expect(jevExample).toContain('"model": "jev-latest"');
    expect(deploy).toContain('QFJ_WORKER_JEV_MODE');
    expect(deploy).toContain('compose.jev.yml');
  });

  it('declares the 200-client chat envelope separately from provider concurrency', () => {
    expect(example).toContain('"globalMaxConcurrentTurns": 200');
    expect(example).toContain('"RIYA": 200');
    expect(example).toContain('"ANISHA": 200');
    expect(example).toContain('"AAROHI": 200');
    expect(example).toContain('"maxConcurrent": 50');
    expect(example).toContain('"maxQueue": 150');
    expect(compose).toContain('stop_grace_period: 120s');
    expect(compose).toContain("cpus: '1.50'");
    expect(compose).toContain('memory: 2048m');
  });

  it('contains no committed credential or private-key material', () => {
    const all = [compose, dockerfile, deploy, activate, disable, example].join('\n');
    expect(all).not.toMatch(/gsk_[A-Za-z0-9]{8,}/);
    expect(all).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY/);
    expect(all).not.toMatch(/postgresql:\/\/[^\s"]+:[^\s"]+@/);
  });
});
