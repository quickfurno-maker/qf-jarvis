import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const gateway = read('deploy/quickfurno-gateway/Dockerfile');
const worker = read('deploy/quickfurno-worker/Dockerfile');
const index = read('apps/quickfurno-gateway/src/index.ts');
const contractFiles = ['coreSubjectAuthorizer.mjs', 'scopedAdvisoryReader.mjs'];
for (const file of contractFiles) {
  assert(read('contracts/vox/' + file).length > 50, 'missing real private reader ' + file);
  assert(
    index.includes('../../../contracts/vox/' + file),
    'gateway contract consumer drift ' + file,
  );
}
for (const [kind, dockerfile] of [
  ['gateway', gateway],
  ['worker', worker],
]) {
  assert.match(dockerfile, /COPY apps\/quickfurno-gateway .\/apps\/quickfurno-gateway/);
  assert.match(
    dockerfile,
    /COPY contracts\/vox .\/contracts\/vox/,
    'builder cannot compile VOX import ' + kind,
  );
  assert.match(
    dockerfile,
    /COPY --from=builder[^\n]*\/build\/contracts\/vox .\/contracts\/vox/,
    'runtime lacks VOX module ' + kind,
  );
  assert(
    dockerfile.indexOf('COPY contracts/vox') < dockerfile.indexOf('RUN pnpm --filter'),
    'contracts must be copied before build ' + kind,
  );
  assert.doesNotMatch(
    dockerfile,
    /ENV QFJ_VOX_ADVISORY_ENABLED=staging/,
    'VOX accidentally enabled in image ' + kind,
  );
}
console.log('VOX22_JARVIS_WORKER_IMAGE_CONTRACTS_PASS imports=2 images=2 no_feature_enable=true');
