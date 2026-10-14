import assert from 'node:assert/strict';import {readFileSync,existsSync} from 'node:fs';import {resolve,posix} from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const docker=readFileSync(resolve(root,'deploy/quickfurno-gateway/Dockerfile'),'utf8');
assert.match(docker,/COPY contracts\/vox \.\/contracts\/vox/);
assert.match(docker,/COPY --from=builder --chown=10002:10002 \/build\/contracts\/vox \.\/contracts\/vox/);
const compiled='/app/apps/quickfurno-gateway/dist/index.js';
for(const dep of ['scopedAdvisoryReader.mjs','coreSubjectAuthorizer.mjs']){
 const runtime=posix.resolve(posix.dirname(compiled),'../../../contracts/vox',dep);
 assert.equal(runtime,'/app/contracts/vox/'+dep);
 assert.ok(existsSync(resolve(root,'contracts/vox',dep)));
 await import(new URL('../../contracts/vox/'+dep,import.meta.url));
 console.log('PASS importable runtime dependency',dep);
}
const src=readFileSync(resolve(root,'apps/quickfurno-gateway/src/index.ts'),'utf8');
assert.match(src,/import\('\.\.\/\.\.\/\.\.\/contracts\/vox\/scopedAdvisoryReader\.mjs'\)/);
assert.match(src,/config.environment !== 'staging'/);
assert.match(src,/turnStoreMode !== 'POSTGRES'/);
console.log('VOX16D_GATEWAY_BUNDLE_CONTRACT_PASS 7/7');
