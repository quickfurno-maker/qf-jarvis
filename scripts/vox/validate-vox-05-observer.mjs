import assert from 'node:assert/strict';
import { signAgentView, VOX_JARVIS_CONTRACT } from '../../contracts/vox/agentView.mjs';
import {
  verifyOnceAgentView,
  requiresCoreAttestationForHandoff,
} from '../../contracts/vox/verifyOnce.mjs';
const secret = 'not-a-real-secret--for-junit-style-test-only--very-long-fixture';
const time = Math.floor(Date.now() / 1000);
const uuid = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const event = {
  schema: VOX_JARVIS_CONTRACT,
  iss: 'qf-jarvis',
  aud: 'vox-web',
  agent: 'AAROHI',
  channel: 'ACQUISITION',
  subjectType: 'prospect',
  subjectId: uuid(1),
  jti: uuid(2),
  revision: 2,
  iat: time,
  exp: time + 120,
  memoryStatus: 'DISABLED',
  humanTakeover: false,
  lastEvent: 'PROSPECT_READY',
};
let n = 0;
const test = async (name, fn) => {
  await fn();
  console.log('PASS ' + name);
  n++;
};
function store() {
  const used = new Set();
  return {
    async claimOnce(k) {
      if (used.has(k)) return false;
      used.add(k);
      return true;
    },
  };
}
await test('one-time verified envelope', async () =>
  assert.equal(
    (await verifyOnceAgentView(signAgentView(event, secret), secret, store(), time)).proofConsumed,
    true,
  ));
await test('replay denied', async () => {
  const s = store(),
    tok = signAgentView(event, secret);
  await verifyOnceAgentView(tok, secret, s, time);
  await assert.rejects(() => verifyOnceAgentView(tok, secret, s, time), /REPLAY/);
});
await test('missing atomic store denied', async () =>
  assert.rejects(
    () => verifyOnceAgentView(signAgentView(event, secret), secret, null, time),
    /DURABLE/,
  ));
await test('backend store error fails closed', async () =>
  assert.rejects(
    () =>
      verifyOnceAgentView(
        signAgentView(event, secret),
        secret,
        {
          claimOnce: async () => {
            throw Error('down');
          },
        },
        time,
      ),
    /down/,
  ));
await test('expired envelope denied', async () =>
  await assert.rejects(
    () => verifyOnceAgentView(signAgentView(event, secret), secret, store(), time + 121),
    /EXPIRED/,
  ));
await test('wrong key denied', async () =>
  await assert.rejects(
    () =>
      verifyOnceAgentView(
        signAgentView(event, secret),
        'wrong-integration-secret-with-more-than-32-chars',
        store(),
        time,
      ),
    /SIGNATURE/,
  ));
const v = await verifyOnceAgentView(signAgentView(event, secret), secret, store(), time);
await test('replay nonce not forwarded to staff', async () =>
  assert.equal(Object.hasOwn(v, 'jti'), false));
await test('read-only permissions only', async () =>
  assert.deepEqual(v.permissions, ['READ_ONLY']));
await test('Aarohi stage not enough to handoff', async () =>
  assert.equal(requiresCoreAttestationForHandoff(v, null), false));
await test('phone match not enough', async () =>
  assert.equal(requiresCoreAttestationForHandoff(v, { phone: '9876543210' }), false));
await test('Core inactive vendor denied', async () =>
  assert.equal(
    requiresCoreAttestationForHandoff(v, {
      verifiedByCore: true,
      prospectId: uuid(1),
      vendorId: uuid(3),
      activeVendor: false,
      registrationIntentConsumed: true,
    }),
    false,
  ));
await test('Core consumed registration and ACTIVE attestation permitted', async () =>
  assert.equal(
    requiresCoreAttestationForHandoff(v, {
      verifiedByCore: true,
      prospectId: uuid(1),
      vendorId: uuid(3),
      activeVendor: true,
      registrationIntentConsumed: true,
    }),
    true,
  ));
await test('wrong prospect attestation denied', async () =>
  assert.equal(
    requiresCoreAttestationForHandoff(v, {
      verifiedByCore: true,
      prospectId: uuid(4),
      vendorId: uuid(3),
      activeVendor: true,
      registrationIntentConsumed: true,
    }),
    false,
  ));
console.log('VOX_05_JARVIS_ONETIME_ADVISORY_PASS ' + n + '/13');
