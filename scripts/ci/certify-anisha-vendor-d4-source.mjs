import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const BASE = '433dc546b2cc3c0661092590f3541cdcec3f07a9';
const PARENT_BRANCH = 'feat/qfj-vendor-funnel-signals-20261112';
const ALLOWED = new Set([
  '.github/workflows/qfj-anisha-d4-vendor-status-no-deploy.yml',
  'apps/api/src/quickfurno-whatsapp/anisha-vendor-next-step.ts',
  'apps/api/src/quickfurno-whatsapp/tests/anisha-vendor-status-gating-d4.test.ts',
  'docs/reports/anisha-d4-vendor-guided-status-20261113.md',
  'scripts/ci/certify-anisha-vendor-d4-source.mjs',
]);
const REQUIRED = [
  'apps/api/src/quickfurno-whatsapp/anisha-vendor-next-step.ts',
  'apps/api/src/quickfurno-whatsapp/tests/anisha-vendor-status-gating-d4.test.ts',
];
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const deny = (code) => {
  console.error('ANISHA_D4_RELEASE_BLOCKED:' + code);
  process.exitCode = 1;
};

let current = '';
try {
  current = git('rev-parse', 'HEAD');
  git('cat-file', '-e', BASE + '^{commit}');
  git('merge-base', '--is-ancestor', BASE, current);
} catch {
  deny('PINNED_PREDECESSOR_IS_NOT_ANCESTOR');
  process.exit(1);
}
if (process.env.GITHUB_HEAD_SHA && current !== process.env.GITHUB_HEAD_SHA)
  deny('EXACT_HEAD_SHA_MISMATCH');
if (process.env.GITHUB_BASE_REF && process.env.GITHUB_BASE_REF !== PARENT_BRANCH)
  deny('WRONG_REVIEWED_PARENT_BRANCH');
const paths = git('diff', '--name-only', BASE, current).split(/\r?\n/u).filter(Boolean);
const changed = new Set(paths);
for (const path of paths) if (!ALLOWED.has(path)) deny('OUT_OF_SCOPE:' + path);
for (const path of REQUIRED) {
  if (!changed.has(path) || !existsSync(path)) deny('REQUIRED_DELTA_MISSING:' + path);
}
const guidance = readFileSync('apps/api/src/quickfurno-whatsapp/anisha-vendor-next-step.ts', 'utf8');
for (const [pattern, reason] of [
  ["locationStatus !== 'verified'", 'UNKNOWN_OFFICE_MUST_BE_UNVERIFIED'],
  ["vendorStatus !== 'approved' || !snapshot.isActive", 'ACCOUNT_APPROVAL_GATE_MISSING'],
  ['explicit contact entitlement', 'PER_LEAD_CONTACT_RULE_MISSING'],
  ['return PACKAGE', 'PACKAGE_BOUNDARY_MISSING'],
]) if (!guidance.includes(pattern)) deny(reason);
if (git('status', '--porcelain') !== '') deny('SOURCE_TREE_NOT_CLEAN');
if (process.exitCode) process.exit(process.exitCode);
console.log('ANISHA_D4_SOURCE_CERTIFICATION_PASS: pinned parent, ' + paths.length + ' allowlisted files; historical replay tests retained');
