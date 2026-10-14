import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPostgresReplayStore } from '../../contracts/vox/postgresReplay.mjs';
let n = 0;
const t = async (name, fn) => {
  await fn();
  n++;
  console.log('PASS ' + name);
};
const now = Math.floor(Date.now() / 1000),
  id = '00000000-0000-4000-8000-000000000001',
  key = 'qf.vox.agent.view.v1:qf-jarvis:' + id;
function fake() {
  const set = new Set();
  return {
    query: async (sql, [hash]) => {
      assert.match(sql, /ON CONFLICT \(key_hash\) DO NOTHING/);
      if (set.has(hash)) return { rows: [] };
      set.add(hash);
      return { rows: [{ key_hash: hash }] };
    },
  };
}
await t('durable claim shape accepted', async () =>
  assert.equal(await createPostgresReplayStore(fake()).claimOnce(key, now + 100), true),
);
await t('duplicate claim rejected', async () => {
  const s = createPostgresReplayStore(fake());
  await s.claimOnce(key, now + 100);
  assert.equal(await s.claimOnce(key, now + 100), false);
});
await t('bad DB refused', async () =>
  assert.throws(() => createPostgresReplayStore(null), /REQUIRED/),
);
await t(
  'wrong prefix refused',
  async () =>
    await assert.rejects(
      () => createPostgresReplayStore(fake()).claimOnce(id, now + 100),
      /INVALID/,
    ),
);
await t(
  'expired refused',
  async () =>
    await assert.rejects(() => createPostgresReplayStore(fake()).claimOnce(key, now - 1), /EXPIRY/),
);
await t(
  'too long TTL refused',
  async () =>
    await assert.rejects(
      () => createPostgresReplayStore(fake()).claimOnce(key, now + 900),
      /EXPIRY/,
    ),
);
await t(
  'DB failure throws closed',
  async () =>
    await assert.rejects(
      () =>
        createPostgresReplayStore({
          query: async () => {
            throw Error('PG_DOWN');
          },
        }).claimOnce(key, now + 100),
      /PG_DOWN/,
    ),
);
await t(
  'DB bad rows denied',
  async () =>
    await assert.rejects(
      () =>
        createPostgresReplayStore({ query: async () => ({ rows: null }) }).claimOnce(
          key,
          now + 100,
        ),
      /BAD_RESPONSE/,
    ),
);
await t(
  'client nonce UUID validated',
  async () =>
    await assert.rejects(
      () =>
        createPostgresReplayStore(fake()).claimOnce(
          'qf.vox.agent.view.v1:qf-jarvis:bad',
          now + 100,
        ),
      /INVALID/,
    ),
);
const sql = readFileSync(
  resolve(import.meta.dirname, '../../contracts/vox/sql/0001_vox_agent_replay_receipts.sql'),
  'utf8',
);
await t('database unique key constraint', async () =>
  assert.match(sql, /key_hash bytea PRIMARY KEY/),
);
await t('no browser grant', async () => assert.match(sql, /REVOKE ALL.*FROM PUBLIC/));
await t('hashed nonce at rest', async () =>
  assert.doesNotMatch(sql, /\bjti\s+text|\bphone\s+text|raw_message/),
);
console.log('VOX10B_JARVIS_POSTGRES_REPLAY_PASS ' + n + '/12');
