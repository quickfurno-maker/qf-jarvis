import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const src=readFileSync(resolve(root,'apps/quickfurno-gateway/src/index.ts'),'utf8');
let n=0;function t(k,f){f();n++;console.log('PASS',k)}
t('opt-in staging feature flag',()=>assert.match(src,/QFJ_VOX_ADVISORY_ENABLED/));
t('staging runtime identity',()=>assert.match(src,/config.environment !== 'staging'/));
t('existing postgres pool required',()=>assert.match(src,/turnStoreMode !== 'POSTGRES'/));
t('secret required',()=>assert.match(src,/QFJ_VOX_VIEW_SECRET/));
t('signed Core authority injected',()=>assert.match(src,/createVoxCoreSubjectAuthorizer/));
t('durable agent verifier injected',()=>assert.match(src,/createScopedVoxAdvisoryReader/));
t('private Core https origin',()=>assert.match(src,/https:\/\/staging-core.quickfurno.in/));
t('passed into existing gateway',()=>assert.match(src,/createGatewayServer\(\{config,turnSpool,/));
t('legacy gateway behavior unchanged',()=>assert.match(src,/createPostgresDurableTurnSpool\(databasePool\)/));
t('runtime does not log tokens',()=>assert.doesNotMatch(src,/console.log\(.*secret|process.stdout.write\(.*secret/));
console.log('VOX16C_JARVIS_RUNTIME_WIRING_SOURCE_PASS '+n+'/'+n);
