#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const read = (p) => readFile(join(ROOT, p), 'utf8');
const contractText = await read('contracts/qfj-phase22-identity-auth-v1.json');
const c = JSON.parse(contractText);
const packageText = await read('package.json');
let passed = 0;
const check = (name, fn) => {
  try {
    fn();
    passed++;
    console.log('PASS ' + name);
  } catch (e) {
    console.error('FAIL ' + name + ' - ' + e.message);
    process.exitCode = 1;
  }
};

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.next'].includes(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.isFile() && ['.ts', '.tsx', '.js', '.mjs', '.cjs'].includes(extname(e.name)))
      out.push(p);
  }
  return out;
}
const roots = ['apps', 'packages', 'scripts'];
let runtime = '';
for (const root of roots) {
  for (const file of await walk(join(ROOT, root))) runtime += '\n' + (await readFile(file, 'utf8'));
}

check('canonical Phase22 contract', () => assert.equal(c.contract, 'qfj.phase22.identity-auth.v1'));
check('exact Jarvis Phase21 baseline', () =>
  assert.equal(c.phase21Baselines.jarvis, '95d3fcc6ff8b304e96591a80402f61f52aded825'),
);
check('QuickFurno owns stable identity and authorization', () => {
  assert.equal(c.authority.stableIdentity, 'QUICKFURNO_INTERNAL_PRINCIPAL');
  assert.equal(c.authority.authorization, 'QUICKFURNO_CORE_ONLY');
});
check('Jarvis gains no end-user IdP authority', () =>
  assert.equal(c.authority.jarvis, 'NO_END_USER_IDP_AUTHORITY'),
);
check('Jarvis runtime does not authenticate Supabase users', () => {
  assert.doesNotMatch(runtime, /\.auth\.getUser\s*\(/u);
  assert.doesNotMatch(packageText, /@supabase\/(?:supabase-js|ssr)/u);
});
check('signed service actor boundary remains separate from end-user identity', () => {
  assert.match(runtime, /x-qfj-actor|QFJ_SCALE_HEADERS/u);
});
check('provider cutover never bridges sessions through Jarvis', () => {
  assert.equal(c.cutover.refreshTokensNeverBridgedAcrossProviders, true);
  assert.equal(c.cutover.reauthenticationRequired, true);
});
check('Jarvis cannot grant provider-derived privilege', () => {
  assert.equal(c.authority.providerClaimsAuthorization, false);
  assert.equal(c.authority.providerUserMetadataAuthorization, false);
});
check('production boundary unchanged', () => {
  assert.equal(c.productionBoundary.productionAuthProviderCutoverPerformed, false);
  assert.equal(c.productionBoundary.productionTrafficCutoverPerformed, false);
});
check('Phase23 is next', () => assert.match(c.exit.nextPhase, /Phase 23/));

const sha = createHash('sha256').update(contractText).digest('hex');
console.log(
  'Jarvis Phase22 ' +
    (process.exitCode ? 'FAILED' : 'PASS') +
    ' (' +
    passed +
    '/10) contractSha256=' +
    sha,
);
if (process.exitCode) process.exit(process.exitCode);
