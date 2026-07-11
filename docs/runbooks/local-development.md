# Runbook: Local development & verification

Operational notes for building, running, and verifying QF Jarvis locally during
Phase 0A.

## Prerequisites

- Node.js 24 LTS
- pnpm 11+ (`corepack enable`)

## First-time setup

```bash
pnpm install
cp .env.example .env   # optional; safe defaults exist without it
```

## The quality gate

Before committing, run the same gate CI runs:

```bash
pnpm check    # format:check → lint → typecheck → test → build
```

Individual gates: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`,
`pnpm test`, `pnpm build`.

## Running the services

Watch mode (both):

```bash
pnpm dev
```

Or run a built service directly:

```bash
pnpm build
node apps/jarvis-api/dist/server.js       # honors JARVIS_API_HOST / JARVIS_API_PORT
node apps/jarvis-worker/dist/index.js
```

## Verifying the API

```bash
curl -s http://127.0.0.1:3000/health/live    # {"status":"ok"}
curl -s http://127.0.0.1:3000/health/ready   # {"status":"ready"}
curl -s http://127.0.0.1:3000/               # {"service":"qf-jarvis-api","status":"running","version":"..."}
```

Logs are line-delimited JSON on stdout, each carrying `service`, `environment`,
and (for requests) a `reqId`.

## Graceful shutdown

Both services handle `SIGTERM` and `SIGINT`:

- **jarvis-api** stops accepting connections, closes Fastify, logs
  `server closed cleanly`, and lets the process drain to exit code 0.
- **jarvis-worker** clears its keep-alive timer, logs
  `qf-jarvis-worker stopped cleanly`, and drains to exit code 0.

On POSIX (Linux/macOS, and the Linux CI runners) send a real signal:

```bash
kill -TERM <pid>     # or Ctrl-C (SIGINT) in the foreground
```

**Windows note:** Windows has no POSIX signals, and MSYS/Git Bash `kill`
force-terminates the process instead of delivering `SIGTERM`/`SIGINT`, so the
graceful-shutdown handlers cannot be observed from Git Bash. The shutdown logic
is covered by unit tests and runs correctly under real signals on Linux. To
exercise the API handler locally on Windows you can emit the event in-process:

```bash
node -e "process.env.JARVIS_API_PORT=3131; import('./apps/jarvis-api/dist/server.js').then(()=>setTimeout(()=>process.emit('SIGTERM'),800))"
```

## Troubleshooting

- **`ERR_PNPM_OUTDATED_LOCKFILE`** — a `package.json` changed without updating
  the lockfile. Run `pnpm install` (locally, not `--frozen-lockfile`) and commit
  `pnpm-lock.yaml`.
- **`ERR_PNPM_IGNORED_BUILDS: esbuild`** — approved in `pnpm-workspace.yaml`
  under `allowBuilds`. esbuild is a dev-only dependency of `tsx`; it is not used
  by the build/test/typecheck gates.
- **Invalid config at startup** — the service prints each offending environment
  variable and exits non-zero. Fix the variable named in the message.
