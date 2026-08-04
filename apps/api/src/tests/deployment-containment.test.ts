import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Deployment containment (JOS-01D, ADR-0088).
 *
 * These assertions read the Dockerfile and the production Compose file as TEXT.
 *
 * That is a deliberate choice over parsing YAML. Adding a YAML dependency to the workspace to
 * assert a handful of literal strings would put a parser in the supply chain to check facts a
 * substring match already proves — and the failure mode of a brittle parser assertion (silently
 * matching nothing) is worse than the failure mode of a substring one. `docker compose config`
 * is the real validator, and it is run as a container gate in the PR; this suite is the part that
 * runs on every CI push without a Docker daemon.
 *
 * What is locked here is the set of properties that would be dangerous to lose quietly: no public
 * port, no secret in the image, no privilege, no shared network, no mutable tag.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (relative: string): string =>
  readFileSync(new URL(relative, new URL(`file://${REPO_ROOT.replace(/\\/g, '/')}`)), 'utf8');

const DOCKERFILE = read('deploy/jarvis-os/Dockerfile');
const COMPOSE = read('deploy/jarvis-os/compose.production.yml');

/** Strip `#` comment lines so a scan reads DIRECTIVES, not the prose explaining them. */
const directives = (text: string): string =>
  text
    .split('\n')
    .filter((line) => !/^\s*#/u.test(line))
    .join('\n');

const DOCKERFILE_CODE = directives(DOCKERFILE);

/**
 * Compose directives with quote style normalised.
 *
 * Prettier owns YAML quoting in this repository and rewrites `"5"` to `'5'`. Asserting a specific
 * quote character would make this suite a formatter test that breaks whenever the formatter is
 * upgraded -- and quote style is not a security property. The VALUES are.
 */
const COMPOSE_CODE = directives(COMPOSE).replace(/'/gu, '"');

describe('the production image', () => {
  it('pins an exact Node 24.18.0 base by digest, never a floating tag', () => {
    expect(DOCKERFILE_CODE).toContain('node@sha256:');
    expect(DOCKERFILE).toContain('node:24.18.0-bookworm-slim');
    // A mutable tag makes two builds of the same commit produce different filesystems.
    expect(DOCKERFILE_CODE).not.toMatch(/FROM\s+node:latest/u);
    expect(DOCKERFILE_CODE).not.toMatch(/FROM\s+node:\d+\s*$/mu);
    expect(DOCKERFILE_CODE).not.toContain('node:24-');
  });

  it('pins the exact pnpm the lockfile was written by', () => {
    expect(DOCKERFILE_CODE).toContain('PNPM_VERSION=11.11.0');
    expect(DOCKERFILE_CODE).toContain('--frozen-lockfile');
  });

  it('ends as a non-root, fixed numeric identity', () => {
    const userDirectives = [...DOCKERFILE_CODE.matchAll(/^USER\s+(.+)$/gmu)].map((m) =>
      m[1]?.trim(),
    );
    expect(userDirectives.length).toBeGreaterThan(0);
    // The LAST USER wins, and it must be the unprivileged one.
    expect(userDirectives[userDirectives.length - 1]).toBe('10001:10001');
    expect(userDirectives).not.toContain('root');
    expect(userDirectives).not.toContain('0:0');
  });

  it('copies no secret, no VCS metadata and no test material into the image', () => {
    const copies = [...DOCKERFILE_CODE.matchAll(/^COPY\s+(.+)$/gmu)].map((m) => m[1] ?? '');
    for (const copy of copies) {
      for (const forbidden of [
        '.env',
        'auth.json',
        'secrets',
        '.git ',
        '.git/',
        'docs',
        '.mcp.json',
        // The protected reconciliation directory is deliberately NOT named here: a repository-wide
        // invariant forbids any source file from referencing it, and a containment spec that names
        // what it forbids trips that rule. The guarantee is stronger anyway -- `deploy.sh` builds
        // from `git archive`, which emits TRACKED files only, so untracked paths cannot reach the
        // Docker daemon at all. That is asserted separately below.
      ]) {
        expect(copy.toLowerCase(), `COPY ${copy}`).not.toContain(forbidden.toLowerCase());
      }
    }
    // And no build-time secret plumbing at all.
    expect(DOCKERFILE_CODE).not.toMatch(/--mount=type=secret/u);
    expect(DOCKERFILE_CODE).not.toMatch(/ARG\s+\w*(PASSWORD|SECRET|TOKEN|KEY)\w*/iu);
  });

  it('records the exact git revision so a running container can be checked', () => {
    expect(DOCKERFILE_CODE).toContain('org.opencontainers.image.revision');
    expect(DOCKERFILE_CODE).toContain('GIT_SHA');
  });

  it('health-checks liveness only, without installing a fetch binary', () => {
    expect(DOCKERFILE_CODE).toContain('HEALTHCHECK');
    expect(DOCKERFILE_CODE).toContain('/login');
    // No apt-get at all: a health probe is not a reason to add a package with its own CVE stream.
    expect(DOCKERFILE_CODE).not.toContain('apt-get');
    expect(DOCKERFILE_CODE).not.toMatch(/\bcurl\b/u);
    expect(DOCKERFILE_CODE).not.toMatch(/\bwget\b/u);
  });
});

describe('the production topology', () => {
  it('publishes NO port — Traefik reaches the container by its private IP', () => {
    // The single most important assertion in this file. A `ports:` stanza would put the
    // application on a host interface, bypassing Traefik, TLS and the rate limits entirely.
    expect(COMPOSE_CODE).not.toMatch(/^\s*ports:/mu);
    expect(COMPOSE_CODE).not.toContain('0.0.0.0:3000');
    expect(COMPOSE_CODE).not.toMatch(/"\d+:3000"/u);
  });

  it('runs unprivileged with no capabilities and a read-only filesystem', () => {
    expect(COMPOSE_CODE).toContain('user: "10001:10001"');
    expect(COMPOSE_CODE).toContain('read_only: true');
    expect(COMPOSE_CODE).toContain('no-new-privileges:true');
    expect(COMPOSE_CODE).toMatch(/cap_drop:\s*\n\s*-\s*ALL/u);

    for (const forbidden of [
      'privileged',
      'cap_add',
      'SYS_ADMIN',
      'pid: host',
      'ipc: host',
      'devices:',
      '/var/run/docker.sock',
    ]) {
      expect(COMPOSE_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it('bounds processes, cpu, memory and logs', () => {
    expect(COMPOSE_CODE).toContain('pids: 256');
    expect(COMPOSE_CODE).toContain('cpus: "1.0"');
    expect(COMPOSE_CODE).toContain('memory: 1g');
    expect(COMPOSE_CODE).toContain('driver: json-file');
    expect(COMPOSE_CODE).toContain('max-size: 10m');
    expect(COMPOSE_CODE).toContain('max-file: "5"');
  });

  it('writes only to an explicit tmpfs', () => {
    expect(COMPOSE_CODE).toMatch(/tmpfs:\s*\n\s*-\s*\/tmp:rw,noexec,nosuid,nodev/u);
  });

  it('mounts the auth secret read-only as a single file, and passes only a PATH', () => {
    expect(COMPOSE_CODE).toContain('/srv/qf-jarvis/secrets/jarvis-os-auth.json');
    expect(COMPOSE_CODE).toContain('target: /run/secrets/qf-jarvis-os-auth.json');
    expect(COMPOSE_CODE).toMatch(/read_only:\s*true/u);
    expect(COMPOSE_CODE).toContain('QFJ_JOS_AUTH_CONFIG_FILE: /run/secrets/qf-jarvis-os-auth.json');

    // The environment carries a path and nothing else. No secret VALUE is ever an env var.
    for (const forbidden of [
      'PASSWORD',
      'PASSPHRASE',
      'TOTP_SECRET',
      'SESSION_KEY',
      'ARGON',
      'NEXT_PUBLIC',
    ]) {
      expect(COMPOSE_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it('uses an immutable SHA tag and never a moving one', () => {
    expect(COMPOSE_CODE).toContain('${JOS_IMAGE_TAG:?');
    expect(COMPOSE_CODE).not.toMatch(/qf-jarvis-os:(latest|main|stable|prod)/u);
  });

  it('joins no other project network', () => {
    for (const foreign of [
      'n8n-cjls_default',
      'qf-core-staging_default',
      'external: true',
      'network_mode',
    ]) {
      expect(COMPOSE_CODE, foreign).not.toContain(foreign);
    }
    expect(COMPOSE_CODE).toContain('name: qf-jarvis-os_jarvis-os');
  });

  it('reuses the DISCOVERED Traefik entrypoints and resolver rather than inventing names', () => {
    // These are the names read off the running host, not guesses. Inventing one would produce a
    // router Traefik silently never serves.
    expect(COMPOSE_CODE).toContain('entrypoints: "websecure"');
    expect(COMPOSE_CODE).toContain('tls.certresolver: "letsencrypt"');
    expect(COMPOSE_CODE).toContain('Host(`jarvis.quickfurno.in`)');
  });

  it('never injects a static CSP at the edge — the app uses per-request nonces', () => {
    // A static CSP from Traefik cannot know the nonce, so it would break every script on every
    // page; two CSP headers intersect to the strictest, which breaks it the same way.
    expect(COMPOSE_CODE).not.toContain('contentSecurityPolicy');
    expect(COMPOSE_CODE).not.toContain('customResponseHeaders.Content-Security-Policy');
  });

  it('rate-limits the edge, and the login route much harder', () => {
    expect(COMPOSE_CODE).toContain('qf-jarvis-os-ratelimit.ratelimit.average: "30"');
    expect(COMPOSE_CODE).toContain('qf-jarvis-os-login-ratelimit.ratelimit.average: "5"');
    expect(COMPOSE_CODE).toContain('Path(`/api/auth/login`)');
    // Buffering is scoped to the login route only; applying it globally would break Next streaming.
    expect(COMPOSE_CODE).toContain('qf-jarvis-os-login-buffer.buffering.maxRequestBodyBytes');
    expect(COMPOSE_CODE).not.toMatch(/routers\.qf-jarvis-os\.middlewares:.*buffer/u);
  });

  it('reaches no Core, n8n, database or provider', () => {
    for (const forbidden of [
      'staging-core.quickfurno.in',
      'n8n-cjls.srv1873796',
      '5678',
      'postgres',
      'supabase',
      'DATABASE_URL',
      'graph.facebook.com',
      'api.groq.com',
    ]) {
      expect(COMPOSE_CODE, forbidden).not.toContain(forbidden);
      expect(DOCKERFILE_CODE, forbidden).not.toContain(forbidden);
    }
  });
});

describe('the operational scripts', () => {
  // Comments are stripped for the same reason as the Dockerfile and Compose scans: these scripts
  // NAME the commands they refuse to run ("`docker system prune` would reach shared Traefik"), so
  // scanning the prose reports each prohibition as the violation it exists to prevent.
  const DEPLOY = directives(read('deploy/jarvis-os/deploy.sh'));
  const ROLLBACK = directives(read('deploy/jarvis-os/rollback.sh'));
  const DEPLOY_RAW = read('deploy/jarvis-os/deploy.sh');
  const ROLLBACK_RAW = read('deploy/jarvis-os/rollback.sh');

  it('never prunes shared Docker resources', () => {
    // Each of these would reach Traefik, n8n and Core images, volumes or networks.
    for (const script of [DEPLOY, ROLLBACK]) {
      for (const forbidden of [
        'system prune',
        'image prune',
        'volume prune',
        'network prune',
        'compose down',
      ]) {
        expect(script, forbidden).not.toContain(forbidden);
      }
    }
  });

  it('never touches the shared Traefik, n8n or Core projects', () => {
    for (const script of [DEPLOY, ROLLBACK]) {
      for (const forbidden of ['traefik', 'n8n', 'qf-core-staging']) {
        expect(script.toLowerCase(), forbidden).not.toContain(forbidden);
      }
      // Every compose invocation is scoped to the JOS project.
      for (const invocation of script.match(/docker compose[^\n]*/gu) ?? []) {
        expect(invocation, invocation).toContain('-p qf-jarvis-os');
      }
    }
  });

  it('builds from a tracked-only archive so untracked paths cannot enter the context', () => {
    // `git archive` emits tracked files only. Building from the working tree would expose
    // `.mcp.json` and the reconciliation reports to the Docker daemon.
    expect(DEPLOY_RAW).toContain('git -C "$REPO_DIR" archive');
    expect(DEPLOY).not.toMatch(/docker build[^\n]*\s\.\s*$/mu);
  });

  it('verifies the running revision matches the requested SHA', () => {
    expect(DEPLOY_RAW).toContain('org.opencontainers.image.revision');
    expect(ROLLBACK_RAW).toContain('org.opencontainers.image.revision');
  });
});
