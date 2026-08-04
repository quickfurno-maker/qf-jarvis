import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Deployment containment (JOS-01D, ADR-0088).
 *
 * These assertions read the Dockerfile, the Compose files and the scripts as TEXT.
 *
 * That is a deliberate choice over parsing YAML. Adding a YAML dependency to the workspace to
 * assert a handful of literal strings would put a parser in the supply chain to check facts a
 * substring match already proves — and the failure mode of a brittle parser assertion (silently
 * matching nothing) is worse than the failure mode of a substring one. `docker compose config`
 * is the real validator, and it is run as a container gate in the PR; this suite is the part that
 * runs on every CI push without a Docker daemon.
 *
 * What is locked here is the set of properties that would be dangerous to lose quietly: no public
 * port, no secret in the image, no privilege, no shared network, no mutable tag, and — since the
 * staged-activation correction — no router on the private base and no HSTS before TLS.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (relative: string): string =>
  readFileSync(new URL(relative, new URL(`file://${REPO_ROOT.replace(/\\/g, '/')}`)), 'utf8');

const DOCKERFILE = read('deploy/jarvis-os/Dockerfile');
const COMPOSE = read('deploy/jarvis-os/compose.production.yml');
const INGRESS = read('deploy/jarvis-os/compose.ingress.yml');
const HSTS = read('deploy/jarvis-os/compose.hsts.yml');

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
const yaml = (text: string): string => directives(text).replace(/'/gu, '"');

const COMPOSE_CODE = yaml(COMPOSE);
const INGRESS_CODE = yaml(INGRESS);
const HSTS_CODE = yaml(HSTS);

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

  it('strips the build toolchain from the runtime image', () => {
    // Every CRITICAL and HIGH finding in the pre-correction scan was in this toolchain, and none
    // were in the application's traced node_modules. Beyond the CVE count, `npm`/`npx` inside a
    // container is an arbitrary-package install-and-execute primitive.
    for (const removed of [
      '/usr/local/lib/node_modules/npm',
      '/usr/local/lib/node_modules/corepack',
      '/usr/local/bin/npm',
      '/usr/local/bin/npx',
      '/usr/local/bin/corepack',
    ]) {
      expect(DOCKERFILE_CODE, removed).toContain(removed);
    }
    expect(DOCKERFILE_CODE).toContain('apt-get purge -y perl');
    // Removing the package manager's own lists too, so the strip does not itself add a layer of
    // stale metadata.
    expect(DOCKERFILE_CODE).toContain('/var/lib/apt/lists/*');
  });

  it('runs as a fixed non-root user', () => {
    const userLines = DOCKERFILE_CODE.match(/^USER\s+.*$/gmu) ?? [];
    expect(userLines.length).toBeGreaterThan(0);
    // The LAST USER wins. A later `USER root` would silently undo the whole hardening story.
    expect(userLines.at(-1)).toBe('USER 10001:10001');
    expect(DOCKERFILE_CODE).toContain('--uid 10001');
  });

  it('copies no secret, no VCS metadata and no documentation into a layer', () => {
    for (const forbidden of [
      'auth.json',
      '.env',
      'COPY .git',
      'docs/',
      '.mcp.json',
      // The protected reconciliation directory is deliberately NOT named here: a repository-wide
      // invariant forbids any source file from referencing it, and a containment spec that names
      // what it forbids trips that rule. The guarantee is stronger anyway -- `deploy.sh` builds
      // from `git archive`, which emits TRACKED files only, so untracked paths cannot reach the
      // Docker daemon at all. That is asserted separately below.
    ]) {
      expect(DOCKERFILE_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it('records the exact revision it was built from', () => {
    expect(DOCKERFILE_CODE).toContain('org.opencontainers.image.revision="${GIT_SHA}"');
  });

  it('health-checks without adding a network binary to the image', () => {
    expect(DOCKERFILE_CODE).toContain('HEALTHCHECK');
    // A liveness probe is not a reason to add a binary with its own CVE stream.
    for (const forbidden of ['curl', 'wget', 'apt-get install']) {
      expect(DOCKERFILE_CODE, forbidden).not.toContain(forbidden);
    }
  });
});

describe('the private base topology', () => {
  it('publishes NO port — Traefik reaches the container by its private IP', () => {
    // The single most important assertion in this file. A `ports:` stanza would put the
    // application on a host interface, bypassing Traefik, TLS and the rate limits entirely.
    for (const file of [COMPOSE_CODE, INGRESS_CODE, HSTS_CODE]) {
      expect(file).not.toMatch(/^\s*ports:/mu);
      expect(file).not.toContain('0.0.0.0:3000');
      expect(file).not.toMatch(/"\d+:3000"/u);
    }
  });

  it('activates NO Traefik router — the base alone is unreachable', () => {
    // The correction that makes the Gate 2 sequence honest. With routing labels here, the router
    // would go live the instant the container started and every "private" proof afterwards would
    // be measuring something already serving the internet.
    expect(COMPOSE_CODE).toContain('traefik.enable: "false"');
    expect(COMPOSE_CODE).not.toContain('traefik.enable: "true"');
    expect(COMPOSE_CODE).not.toContain('traefik.http.');
    expect(COMPOSE_CODE).not.toContain('traefik.docker.network');
    // Stated explicitly rather than relying on the shared Traefik's `exposedByDefault=false`,
    // which is a setting this project does not own.
    expect(COMPOSE_CODE).not.toContain('certresolver');
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
      for (const file of [COMPOSE_CODE, INGRESS_CODE, HSTS_CODE, DOCKERFILE_CODE]) {
        expect(file, forbidden).not.toContain(forbidden);
      }
    }
  });
});

describe('the ingress overlay', () => {
  it('is additive: it declares only the jarvis-os service and no infrastructure', () => {
    // An overlay that redeclared networks, volumes or another service could silently change the
    // base topology while looking like it only added labels.
    expect(INGRESS_CODE).toMatch(/^services:\s*$/mu);
    expect(INGRESS_CODE).toContain('jarvis-os:');
    expect(INGRESS_CODE).not.toMatch(/^networks:/mu);
    expect(INGRESS_CODE).not.toMatch(/^volumes:/mu);
    expect(INGRESS_CODE).not.toMatch(/^\s{2}(traefik|n8n|qf-core-staging):/mu);
    // It must not re-open any of the hardening the base establishes.
    for (const forbidden of ['read_only: false', 'privileged', 'cap_add', 'user: "0:0"']) {
      expect(INGRESS_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it('is the only thing that turns routing on', () => {
    expect(INGRESS_CODE).toContain('traefik.enable: "true"');
    expect(INGRESS_CODE).toContain('traefik.docker.network: "qf-jarvis-os_jarvis-os"');
  });

  it('reuses the DISCOVERED Traefik entrypoints and resolver rather than inventing names', () => {
    // These are the names read off the running host, not guesses. Inventing one would produce a
    // router Traefik silently never serves.
    expect(INGRESS_CODE).toContain('entrypoints: "websecure"');
    expect(INGRESS_CODE).toContain('tls.certresolver: "letsencrypt"');
    expect(INGRESS_CODE).toContain('Host(`jarvis.quickfurno.in`)');
  });

  it('rate-limits the edge, and the login route much harder', () => {
    expect(INGRESS_CODE).toContain('qf-jarvis-os-ratelimit.ratelimit.average: "30"');
    expect(INGRESS_CODE).toContain('qf-jarvis-os-login-ratelimit.ratelimit.average: "5"');
    expect(INGRESS_CODE).toContain('Path(`/api/auth/login`)');
    // Buffering is scoped to the login route only; applying it globally would break Next streaming.
    expect(INGRESS_CODE).toContain('qf-jarvis-os-login-buffer.buffering.maxRequestBodyBytes');
    expect(INGRESS_CODE).not.toMatch(/routers\.qf-jarvis-os\.middlewares:.*buffer/u);
  });

  it('carries no HSTS — that waits for proven TLS', () => {
    // HSTS in this overlay would go live at the same moment as the router, before any certificate
    // has been observed working.
    for (const forbidden of ['stsSeconds', 'forceSTSHeader', 'Strict-Transport-Security']) {
      expect(INGRESS_CODE, forbidden).not.toContain(forbidden);
    }
  });
});

describe('the HSTS overlay', () => {
  it('exists as a reviewed repository artefact rather than a production edit', () => {
    // The point of the correction: these values were reviewed in Git before anything was
    // deployed, instead of being typed into a live host after merge.
    expect(HSTS_CODE).toContain('traefik.http.middlewares.qf-jarvis-os-hsts.headers.');
  });

  it('uses exactly the reviewed values', () => {
    expect(HSTS_CODE).toContain('headers.stsSeconds: "31536000"');
    // Sibling hostnames under quickfurno.in are not this project's to bind.
    expect(HSTS_CODE).toContain('headers.stsIncludeSubdomains: "false"');
    // Preload submission is effectively irreversible and is a whole-domain decision.
    expect(HSTS_CODE).toContain('headers.stsPreload: "false"');
    // The header is only meaningful on an already-secure connection.
    expect(HSTS_CODE).toContain('headers.forceSTSHeader: "false"');
  });

  it('attaches to both public routers without dropping their existing middlewares', () => {
    // `middlewares` is one ordered label, so the overlay must restate each full chain. A chain
    // that quietly lost a rate limiter here would look like it had only added HSTS.
    expect(HSTS_CODE).toContain(
      'routers.qf-jarvis-os.middlewares: "qf-jarvis-os-ratelimit@docker,qf-jarvis-os-hsts@docker"',
    );
    expect(HSTS_CODE).toContain(
      'routers.qf-jarvis-os-login.middlewares: "qf-jarvis-os-login-ratelimit@docker,qf-jarvis-os-login-buffer@docker,qf-jarvis-os-hsts@docker"',
    );

    // Every middleware the ingress overlay attaches must survive into the HSTS chains.
    const ingressChains = INGRESS_CODE.match(/routers\.[\w-]+\.middlewares: "([^"]+)"/gu) ?? [];
    expect(ingressChains).toHaveLength(2);
    for (const chain of ingressChains) {
      const [, list] = /"([^"]+)"/u.exec(chain) ?? [];
      for (const middleware of (list ?? '').split(',')) {
        expect(HSTS_CODE, middleware).toContain(middleware);
      }
    }
  });

  it('is additive and JOS-only', () => {
    expect(HSTS_CODE).not.toMatch(/^networks:/mu);
    expect(HSTS_CODE).not.toMatch(/^volumes:/mu);
    expect(HSTS_CODE).not.toMatch(/^\s{2}(traefik|n8n|qf-core-staging):/mu);
    expect(HSTS_CODE).not.toMatch(/^\s*ports:/mu);
  });
});

describe('no static CSP is ever injected at the edge', () => {
  it('appears in none of the compose files', () => {
    // The application emits a per-request nonce policy. A static CSP from Traefik cannot know the
    // nonce, so it would break every script on every page; and two CSP headers intersect to the
    // strictest, which breaks it the same way.
    for (const file of [COMPOSE_CODE, INGRESS_CODE, HSTS_CODE]) {
      expect(file).not.toContain('contentSecurityPolicy');
      expect(file).not.toContain('customResponseHeaders.Content-Security-Policy');
      expect(file).not.toContain('customResponseHeaders.content-security-policy');
    }
  });
});

describe('the operational scripts', () => {
  // Comments are stripped for the same reason as the Dockerfile and Compose scans: these scripts
  // NAME the commands they refuse to run ("`docker system prune` would reach shared Traefik"), so
  // scanning the prose reports each prohibition as the violation it exists to prevent.
  const RAW = {
    deploy: read('deploy/jarvis-os/deploy.sh'),
    activate: read('deploy/jarvis-os/activate.sh'),
    rollback: read('deploy/jarvis-os/rollback.sh'),
    smoke: read('deploy/jarvis-os/smoke.sh'),
    verify: read('deploy/jarvis-os/verify-merged-sha.sh'),
  };
  const CODE = Object.fromEntries(
    Object.entries(RAW).map(([name, text]) => [name, directives(text)]),
  ) as Record<keyof typeof RAW, string>;
  const ALL = Object.values(CODE);

  it('never prunes shared Docker resources', () => {
    // Each of these would reach Traefik, n8n and Core images, volumes or networks.
    for (const script of ALL) {
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

  it('never runs a lifecycle command against the shared Traefik, n8n or Core projects', () => {
    // Asserted as COMMANDS rather than as the substring "traefik": the scripts legitimately read
    // and set `traefik.enable` labels on their OWN container, and a blanket substring ban would
    // force that honest code to be obfuscated to pass.
    for (const script of ALL) {
      expect(script).not.toMatch(
        /docker\s+(restart|stop|start|kill|rm|rmi|pull|update|exec)\s+[^\n]*\b(traefik|n8n|qf-core-staging)\b/u,
      );
      expect(script).not.toMatch(/-p\s+(traefik|n8n|qf-core-staging)\b/u);
      expect(script).not.toMatch(/compose[^\n]*\b(pull|up)\b[^\n]*\btraefik\b/u);

      // Every compose invocation is scoped to the JOS project.
      for (const invocation of script.match(/docker compose[^\n]*/gu) ?? []) {
        expect(invocation, invocation).toContain('-p qf-jarvis-os');
      }
    }
  });

  it('builds from a tracked-only archive so untracked paths cannot enter the context', () => {
    // `git archive` emits tracked files only. Building from the working tree would expose
    // `.mcp.json` and the reconciliation reports to the Docker daemon.
    expect(RAW.deploy).toMatch(/git .*-C "\$REPO_DIR" archive/u);
    expect(CODE.deploy).not.toMatch(/docker build[^\n]*\s\.\s*$/mu);
  });

  it('deploys privately: the base compose only, with no ingress overlay', () => {
    expect(CODE.deploy).toContain('compose.production.yml');
    expect(CODE.deploy).not.toContain('compose.ingress.yml');
    expect(CODE.deploy).not.toContain('compose.hsts.yml');
  });

  it('proves the container before anything can route to it', () => {
    for (const proof of [
      'org.opencontainers.image.revision',
      'ReadonlyRootfs',
      'CapDrop',
      'no-new-privileges',
      'NetworkSettings.Ports',
      'HostPort',
      'State.Health.Status',
    ]) {
      expect(CODE.deploy, proof).toContain(proof);
    }
    // And explicitly that Traefik cannot yet see it, read off the running container.
    expect(CODE.deploy).toContain('traefik.enable');
    expect(CODE.deploy).toMatch(/traefik\\\.http\\\./u);
  });

  it('activates ingress and HSTS only as additive, correctly ordered overlays', () => {
    expect(CODE.activate).toContain(
      '-f "$HERE/compose.production.yml" -f "$HERE/compose.ingress.yml"',
    );
    // HSTS is applied ON TOP of ingress, never instead of it: the middleware would otherwise be
    // defined and attached to routers that do not exist.
    expect(CODE.activate).toMatch(
      /hsts\)\s*FILES=\(-f "\$HERE\/compose\.production\.yml" -f "\$HERE\/compose\.ingress\.yml" -f "\$HERE\/compose\.hsts\.yml"\)/u,
    );
    expect(CODE.activate).toContain('31536000');
  });

  it('requires an explicit stage on rollback rather than guessing one', () => {
    // Neither default is safe: `private` would silently drop HSTS from a host whose browsers have
    // already been told to refuse plain HTTP; the full set would silently expose a private one.
    expect(CODE.rollback).toMatch(/private\)/u);
    expect(CODE.rollback).toMatch(/ingress\)/u);
    expect(CODE.rollback).toMatch(/hsts\)/u);
    expect(CODE.rollback).toContain('usage');
    expect(RAW.rollback).toContain('org.opencontainers.image.revision');
  });

  it('depends on no GitHub CLI or API token', () => {
    for (const script of ALL) {
      expect(script).not.toMatch(/\bgh\s+(pr|api|auth|repo)\b/u);
      expect(script).not.toContain('GITHUB_TOKEN');
      expect(script).not.toContain('api.github.com');
    }
  });
});

describe('the Gate 2 smoke test', () => {
  const SMOKE = read('deploy/jarvis-os/smoke.sh');
  const SMOKE_CODE = directives(SMOKE);

  it('has explicit pre-HSTS and final modes', () => {
    expect(SMOKE_CODE).toContain('pre-hsts');
    expect(SMOKE_CODE).toContain('final');
    // No default mode: a smoke test that guesses which gate it is at cannot enforce either.
    expect(SMOKE_CODE).toMatch(/MODE="\$\{1:-\}"/u);
  });

  it('requires exactly one CSP header and fails on a duplicate', () => {
    // The previous version counted CSP headers and discarded the result with `|| true`, so an
    // edge-injected second policy — which breaks every nonced script — passed silently.
    expect(SMOKE_CODE).toContain('CSP_COUNT');
    expect(SMOKE_CODE).toMatch(/check "content-security-policy header count" "1" "\$CSP_COUNT"/u);
    expect(SMOKE_CODE).toContain('nonce-');
    // The count must not be computed and then thrown away.
    expect(SMOKE_CODE).not.toMatch(/grep -c[^\n]*content-security-policy[^\n]*\|\| true\s*$/mu);
  });

  it('treats HSTS as forbidden before activation and mandatory at the final gate', () => {
    expect(SMOKE_CODE).toMatch(/check "HSTS absent before activation" "0" "\$STS_COUNT"/u);
    expect(SMOKE_CODE).toMatch(/check "HSTS header count" "1" "\$STS_COUNT"/u);
    expect(SMOKE_CODE).toContain('max-age=31536000');
    // The two settings that were reviewed as deliberately off.
    expect(SMOKE_CODE).toContain('includeSubDomains must be absent');
    expect(SMOKE_CODE).toContain('preload must be absent');
  });

  it('pins the MEASURED redirect status and verifies the target, not "any 3xx"', () => {
    // 301 is what the shared `web` entrypoint was observed returning during the audit. Traefik's
    // entrypoint redirection returns 302 unless `permanent` is set, so pinning the observed value
    // is what lets this notice that shared ingress behaviour changed underneath us.
    expect(SMOKE_CODE).toMatch(/check "http -> https status" "301"/u);
    expect(SMOKE_CODE).toContain('https://${HOST}/login');
    expect(SMOKE_CODE).not.toMatch(/3\[0-9\]\[0-9\]/u);
  });

  it('never performs a login or transmits a credential', () => {
    // Asserted as TRANSMISSION, not as the substring "password"/"totp": the leakage stage
    // legitimately greps responses for those very words, and banning the substring outright would
    // force the check that looks for disclosed credentials to stop naming them.
    expect(SMOKE_CODE).not.toContain('Authorization:');

    // Scoped to the curl invocations themselves. A blanket scan would trip over unrelated flags
    // that happen to share a spelling -- `tr -d '\r'` is not a credential.
    const invocations = SMOKE_CODE.match(/curl[^\n|]*/gu) ?? [];
    expect(invocations.length).toBeGreaterThan(4);
    for (const invocation of invocations) {
      expect(invocation, invocation).toMatch(/^curl\s+-s/u);
      for (const flag of ['--data', ' -d ', '--user', ' -u ', '-X POST', '--request']) {
        expect(invocation, `${flag} in: ${invocation}`).not.toContain(flag);
      }
    }
  });
});

/**
 * The merged-main guard, executed for real.
 *
 * This is the one check that decides whether unreviewed code can reach production, so it is tested
 * by RUNNING it rather than by reading it.
 *
 * It runs against a hermetic throwaway repository rather than this one. Using this repository would
 * mean the "unmerged commit is rejected" case stopped testing anything the moment this branch
 * merged into main — the assertion would still pass, for the wrong reason, forever.
 */
describe('the merged-main commit guard', () => {
  const GUARD = join(REPO_ROOT, 'deploy', 'jarvis-os', 'verify-merged-sha.sh');
  let dir = '';
  let work = '';
  let mergedSha = '';
  let unmergedSha = '';

  const git = (cwd: string, ...args: string[]): string =>
    execFileSync(
      'git',
      [
        '-c',
        'user.email=t@example.invalid',
        '-c',
        'user.name=test',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      { cwd, encoding: 'utf8' },
    ).trim();

  /** Run the guard; return its exit code and combined output. */
  const run = (sha: string): { code: number; out: string } => {
    try {
      // No environment override and no skip flag: the fixture's `origin` is a local bare repo, so
      // the guard's mandatory `git fetch --prune origin` runs for real and offline. That exercises
      // the freshness path rather than switching it off to make the test convenient.
      const out = execFileSync('bash', [GUARD, sha, work], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { code: 0, out };
    } catch (error) {
      const e = error as { status?: number; stdout?: string; stderr?: string };
      return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'jos-guard-'));
    const origin = join(dir, 'origin.git');
    work = join(dir, 'work');

    git(dir, 'init', '--bare', '--initial-branch=main', origin);
    git(dir, 'init', '--initial-branch=main', work);
    writeFileSync(join(work, 'a.txt'), 'reviewed\n');
    git(work, 'add', 'a.txt');
    git(work, 'commit', '-m', 'reviewed commit');
    git(work, 'remote', 'add', 'origin', origin);
    git(work, 'push', '-u', 'origin', 'main');
    mergedSha = git(work, 'rev-parse', 'HEAD');

    // A commit that exists locally but was never pushed — exactly the "head of the branch you were
    // just reading" mistake this guard exists to catch.
    git(work, 'checkout', '-b', 'feature');
    writeFileSync(join(work, 'b.txt'), 'unreviewed\n');
    git(work, 'add', 'b.txt');
    git(work, 'commit', '-m', 'unreviewed commit');
    unmergedSha = git(work, 'rev-parse', 'HEAD');
    // Two real repositories, a push and several git invocations. Vitest's 10s default hook timeout
    // is not enough on a cold filesystem cache, and a flaky release guard is worse than a slow one.
  }, 120_000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('accepts a commit contained in origin/main', () => {
    const { code, out } = run(mergedSha);
    expect(out).toContain('contained in origin/main');
    expect(code).toBe(0);
  });

  it('REJECTS a real commit that exists but is not merged', () => {
    const { code, out } = run(unmergedSha);
    expect(code).not.toBe(0);
    expect(out).toContain('NOT contained in origin/main');
  });

  it('rejects a malformed SHA', () => {
    for (const bad of [
      'de3ee71', // abbreviated
      'main', // branch name
      'HEAD', // symbolic
      'zzzee711c9c85bb2de854d915745de784409132c', // non-hex
      'a'.repeat(41), // too long
      '', // empty
    ]) {
      const { code, out } = run(bad);
      expect(code, bad).not.toBe(0);
      expect(out, bad).toMatch(/not a full 40-character hex commit SHA|usage/u);
    }
  });

  it('rejects a well-formed SHA that does not exist', () => {
    const { code, out } = run('0123456789012345678901234567890123456789');
    expect(code).not.toBe(0);
    expect(out).toContain('does not exist');
  });
});

/**
 * The immutable per-SHA release package, exercised for real.
 *
 * The image was already bound to a commit. The CONFIGURATION was not: Compose files, Traefik
 * labels, HSTS values and the scripts themselves were read from whatever directory the script
 * lived in, so a deployment could be truthfully labelled with a commit whose hardening it was not
 * running. These tests drive `prepare-release.sh` and `verify-release-artifacts.sh` against a
 * hermetic fixture repository and try to break the result in every way that matters.
 */
describe('the immutable release package', () => {
  const JOS = join(REPO_ROOT, 'deploy', 'jarvis-os');
  let dir = '';
  let work = '';
  let root = '';
  let release = '';
  let pristine = '';
  let sha = '';

  /**
   * Whether the filesystem under test honours POSIX mode bits and symlinks.
   *
   * Windows checkouts silently ignore `chmod` and cannot create symlinks, so the permission,
   * executable-bit and symlink cases cannot be staged there. They are asserted against the guard's
   * source instead, and run for real on Linux — which is both CI (ubuntu-latest) and the
   * production host, the only places the check actually has to work.
   */
  let posix = false;

  const git = (cwd: string, ...args: string[]): string =>
    execFileSync(
      'git',
      [
        '-c',
        'user.email=t@example.invalid',
        '-c',
        'user.name=test',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      { cwd, encoding: 'utf8' },
    ).trim();

  /**
   * Windows paths must reach bash in POSIX form.
   *
   * A backslash path survives argv intact but is then re-interpreted inside the script -- `tar -C`
   * treats the separators as escapes. Production and CI are Linux, where this is a no-op.
   */
  const posixPath = (p: string): string => p.replace(/\\/gu, '/');

  const runBash = (args: string[]): { code: number; out: string } => {
    try {
      return {
        code: 0,
        out: execFileSync('bash', args.map(posixPath), {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
      };
    } catch (error) {
      const e = error as { status?: number; stdout?: string; stderr?: string };
      return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
  };

  const verify = (releaseDir: string): { code: number; out: string } =>
    runBash([join(JOS, 'verify-release-artifacts.sh'), sha, releaseDir, work, root]);

  /** Restore the package to its verified state, then apply one specific corruption. */
  const corrupt = (mutate: () => void): { code: number; out: string } => {
    rmSync(release, { recursive: true, force: true });
    cpSync(pristine, release, { recursive: true });
    mutate();
    return verify(release);
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'jos-release-'));
    const origin = join(dir, 'origin.git');
    work = join(dir, 'work');
    root = join(dir, 'releases');
    mkdirSync(root, { recursive: true });

    git(dir, 'init', '--bare', '--initial-branch=main', origin);
    git(dir, 'init', '--initial-branch=main', work);
    mkdirSync(join(work, 'deploy', 'jarvis-os'), { recursive: true });
    cpSync(JOS, join(work, 'deploy', 'jarvis-os'), { recursive: true });

    git(work, 'add', 'deploy');
    for (const name of readdirSync(JOS).filter((n) => n.endsWith('.sh'))) {
      git(work, 'update-index', '--chmod=+x', `deploy/jarvis-os/${name}`);
    }
    git(work, 'commit', '-m', 'release fixture');
    git(work, 'remote', 'add', 'origin', origin);
    git(work, 'push', '-u', 'origin', 'main');
    sha = git(work, 'rev-parse', 'HEAD');

    const prepared = runBash([
      join(work, 'deploy', 'jarvis-os', 'prepare-release.sh'),
      sha,
      work,
      root,
    ]);
    expect(prepared.code, prepared.out).toBe(0);
    release = prepared.out.trim();

    pristine = join(dir, 'pristine');
    cpSync(release, pristine, { recursive: true });

    const probe = join(release, 'compose.production.yml');
    chmodSync(probe, 0o664);
    posix = (statSync(probe).mode & 0o777) === 0o664;
    chmodSync(probe, 0o644);
  }, 120_000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('prepares the package from tracked content of exactly that commit', () => {
    const prepare = read('deploy/jarvis-os/prepare-release.sh');
    // `git archive` emits tracked files only, so untracked local material -- including the
    // protected paths -- cannot enter a release regardless of the working tree's state.
    expect(prepare).toContain('archive --format=tar "$SHA" -- "$SUBDIR"');
    expect(prepare).toContain("SUBDIR='deploy/jarvis-os'");
    // Only the deployment directory: the whole repository is never copied to the host.
    expect(prepare).toContain('--strip-components=2');
    // Byte equality must not depend on the host's line-ending configuration.
    expect(prepare).toContain('core.autocrlf=false');
    // Published by atomic rename, so a half-written release is never reachable under its final name.
    expect(prepare).toContain('mv -T "$STAGE" "$TARGET"');
    expect(release).toBe(posixPath(join(root, sha, 'jarvis-os')));
  });

  it('accepts the package it just prepared', () => {
    const { code, out } = verify(release);
    expect(out).toContain('byte for byte');
    expect(code).toBe(0);
  });

  it('REJECTS a package whose configuration was edited', () => {
    // The whole point: an image can be genuinely built from the right commit while the Compose
    // file beside it is stale or hand-edited.
    const { code, out } = corrupt(() => {
      appendFileSync(join(release, 'compose.production.yml'), '\n# tampered\n');
    });
    expect(code).not.toBe(0);
    expect(out).toContain('does not match its Git blob');
  });

  it('REJECTS a missing deployment file', () => {
    const { code, out } = corrupt(() => {
      rmSync(join(release, 'compose.hsts.yml'));
    });
    expect(code).not.toBe(0);
    expect(out).toContain('file set does not match');
  });

  it('REJECTS an unexpected extra file that could influence Compose', () => {
    // An extra fragment matters as much as a missing one: it can change what Compose merges.
    const { code, out } = corrupt(() => {
      writeFileSync(join(release, 'compose.override.yml'), 'services: {}\n');
    });
    expect(code).not.toBe(0);
    expect(out).toContain('file set does not match');
  });

  it('REJECTS a secret-shaped file inside the release package', () => {
    const { code, out } = corrupt(() => {
      writeFileSync(join(release, 'jarvis-os-auth.json'), '{}\n');
    });
    expect(code).not.toBe(0);
    // Either guard is a correct refusal: the file-set check fires first, and the secret scan
    // backstops anything that somehow matched the tree.
    expect(out).toMatch(/file set does not match|secret-shaped/u);
  });

  it('REJECTS a package outside the approved releases root', () => {
    // This is what forbids deploying from a mutable shared directory, which belongs to no commit
    // and can be edited between releases.
    const mutable = join(dir, 'mutable-deploy');
    cpSync(pristine, mutable, { recursive: true });
    const { code, out } = verify(mutable);
    expect(code).not.toBe(0);
    expect(out).toContain('Refusing to deploy from an unapproved path');
  });

  it('REJECTS a group- or world-writable artefact', () => {
    if (!posix) {
      // The write bit is 2, so the writable octal digits are 2, 3, 6 and 7 -- an earlier version
      // of this guard permitted [0-5], which let 2 and 3 through.
      expect(read('deploy/jarvis-os/verify-release-artifacts.sh')).toContain('^[0145]$');
      return;
    }
    const { code, out } = corrupt(() => {
      chmodSync(join(release, 'compose.production.yml'), 0o664);
    });
    expect(code).not.toBe(0);
    expect(out).toContain('group- or world-writable');
  });

  it('REJECTS an executable bit that disagrees with Git', () => {
    if (!posix) {
      expect(read('deploy/jarvis-os/verify-release-artifacts.sh')).toContain(
        'is executable in Git but not on disk',
      );
      return;
    }
    const { code, out } = corrupt(() => {
      chmodSync(join(release, 'deploy.sh'), 0o644);
    });
    expect(code).not.toBe(0);
    expect(out).toContain('executable in Git but not on disk');
  });

  it('REJECTS a symlinked deployment file', () => {
    if (!posix) {
      expect(read('deploy/jarvis-os/verify-release-artifacts.sh')).toContain(
        'Release artefacts must be ordinary files',
      );
      return;
    }
    const { code, out } = corrupt(() => {
      const target = join(release, 'compose.ingress.yml');
      rmSync(target);
      symlinkSync(join(pristine, 'compose.ingress.yml'), target);
    });
    expect(code).not.toBe(0);
    expect(out).toMatch(/symlink|ordinary files/u);
  });

  it('refuses to overwrite a divergent existing release', () => {
    rmSync(release, { recursive: true, force: true });
    cpSync(pristine, release, { recursive: true });
    appendFileSync(join(release, 'compose.ingress.yml'), '\n# drifted\n');

    const { code, out } = runBash([
      join(work, 'deploy', 'jarvis-os', 'prepare-release.sh'),
      sha,
      work,
      root,
    ]);
    expect(code).not.toBe(0);
    expect(out).toContain('Refusing to overwrite a divergent release');

    rmSync(release, { recursive: true, force: true });
    cpSync(pristine, release, { recursive: true });
  });
});

describe('deployment configuration is bound to the release SHA', () => {
  const DEPLOY = read('deploy/jarvis-os/deploy.sh');
  const ACTIVATE = read('deploy/jarvis-os/activate.sh');
  const ROLLBACK = read('deploy/jarvis-os/rollback.sh');
  const ALL_SCRIPTS = readdirSync(join(REPO_ROOT, 'deploy', 'jarvis-os'))
    .filter((n) => n.endsWith('.sh'))
    .map((n) => read(`deploy/jarvis-os/${n}`));

  it('deploy verifies BOTH the commit and its own artefacts before touching Docker', () => {
    const artefacts = DEPLOY.indexOf('verify-release-artifacts.sh');
    const build = DEPLOY.indexOf('docker build');
    const up = DEPLOY.indexOf('docker compose');
    expect(DEPLOY.indexOf('verify-merged-sha.sh')).toBeGreaterThan(-1);
    expect(artefacts).toBeGreaterThan(-1);
    // Ordering is the property that matters: a check after the build proves nothing.
    expect(artefacts).toBeLessThan(build);
    expect(artefacts).toBeLessThan(up);
    expect(DEPLOY).toContain('"$HERE/verify-release-artifacts.sh" "$SHA" "$HERE"');
  });

  it('activate verifies the commit, its overlays, and the RUNNING revision', () => {
    expect(ACTIVATE).toContain('"$HERE/verify-merged-sha.sh" "$SHA"');
    expect(ACTIVATE).toContain('"$HERE/verify-release-artifacts.sh" "$SHA" "$HERE"');
    // Overlays from one commit must never be applied to an image from another.
    expect(ACTIVATE).toContain('RUNNING_BEFORE');
    expect(ACTIVATE).toContain('"$RUNNING_BEFORE" == "$SHA"');
    expect(ACTIVATE.indexOf('RUNNING_BEFORE')).toBeLessThan(ACTIVATE.indexOf('docker compose'));
  });

  it('rollback uses the PREVIOUS release package, not the running script directory', () => {
    // Re-pointing only the image would combine an old image with today's hardening, labels and
    // HSTS -- and if today's configuration is the fault, the rollback carries it along.
    expect(ROLLBACK).toContain('PREV="${RELEASES_ROOT}/${SHA}/jarvis-os"');
    for (const stage of ['compose.production.yml', 'compose.ingress.yml', 'compose.hsts.yml']) {
      expect(ROLLBACK, stage).toContain(`"$PREV/${stage}"`);
    }
    // It must not fall back to its own directory for compose files.
    expect(ROLLBACK).not.toMatch(/-f "\$HERE\/compose\./u);
    // Integrity of the previous package is verified before it is applied.
    expect(ROLLBACK).toContain('verify-release-artifacts.sh" "$SHA" "$PREV"');
    // And it fails closed when that package is absent.
    expect(ROLLBACK).toContain('no release package at');
    // Emergency rollback must not depend on reaching a remote or on rebuilding. Read as
    // DIRECTIVES: the script's own comments explain why it does not call the fetching guard, and
    // scanning the prose would report that explanation as the violation.
    const rollbackCode = directives(ROLLBACK);
    expect(rollbackCode).not.toContain('verify-merged-sha.sh');
    expect(rollbackCode).not.toContain('docker build');
  });

  it('verifies the stage a rollback actually landed in', () => {
    expect(ROLLBACK).toContain('prove "traefik.enable" "false"');
    expect(ROLLBACK).toContain('prove "HSTS max-age" "31536000"');
  });

  it('grants no authority to a mutable shared deployment directory', () => {
    // DIRECTIVES only: the scripts explain in prose that this path is exactly what they refuse to
    // trust, and scanning the explanation would report it as the violation. `/srv/qf-jarvis/repo`
    // and `/srv/qf-jarvis/secrets` remain legitimate code paths; the deployment package does not.
    for (const script of ALL_SCRIPTS) {
      expect(directives(script)).not.toContain('/srv/qf-jarvis/deploy');
    }
    expect(read('deploy/jarvis-os/README.md')).not.toContain('/srv/qf-jarvis/deploy/');
  });

  it('recreates only the qf-jarvis-os project, and never a shared one', () => {
    for (const script of ALL_SCRIPTS) {
      for (const invocation of script.match(/docker compose[^\n]*/gu) ?? []) {
        expect(invocation, invocation).toContain('-p qf-jarvis-os');
      }
      expect(script).not.toMatch(
        /docker\s+(restart|stop|start|kill|rm|rmi|pull|update)\s+[^\n]*\b(traefik|n8n|qf-core-staging)\b/u,
      );
    }
  });
});
