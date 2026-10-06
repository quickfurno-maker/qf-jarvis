# Scale Phase 15 — Jarvis immutable release and blue/green control

This is the **scale-roadmap Phase 15** deployment layer. It does not activate the older Jarvis product-roadmap “Phase 15 — Controlled Automation Rollout”.

## Release topology

- **Jarvis OS:** blue/green. The inactive digest is started privately with `traefik.enable=false`, its OCI revision and health are proven, and only a separately installed root-owned switch adapter may change traffic.
- **QuickFurno↔Jarvis gateway:** immutable **rolling** replacement after the new Jarvis OS public smoke succeeds.
- **WhatsApp worker:** immutable **disable → replace → READY proof → activate**. Two active generations are intentionally forbidden; durable consumers do not become blue/green merely for symmetry.
- The Phase-11 V0/V1 rolling HTTP contract is the compatibility bridge during the mixed-version interval.

## Trust chain

The three GHCR digests are built once, vulnerability-scanned, supplied with SPDX SBOMs, keyless-signed, bound to a single `qf.release.phase15.v1` manifest, and GitHub-provenance-attested. Promotion accepts exact digests only.

## Database rule

The Phase-14 database changes remain `SOURCE_ONLY`. Phase 15 performs no production migration. Destructive/contract migrations cannot be promoted through blue/green.

## Production boundary

Repository code is source/CI certified only. Production application stays disabled until:

1. GitHub `production` has required reviewers;
2. a dedicated `qfj-phase15-deployer` runner exists on the Jarvis host;
3. root-owned release-control files are installed under `/srv/qf-jarvis/release-control`;
4. a separately reviewed `/usr/local/sbin/qfj-phase15-switch` adapter is installed for the discovered Traefik topology;
5. `PHASE15_PRODUCTION_CUTOVER_ENABLED=true` is deliberately set;
6. the first blue/green rehearsal is owner-approved.

AGNI and OpenAI receive no deployment-host credential or arbitrary shell authority.
