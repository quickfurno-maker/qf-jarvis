import { createHash } from 'node:crypto';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PREFIX = 'qf.vox.agent.view.v1:qf-jarvis:';
/** Atomic durable postgres replay claim, injected trusted Jarvis DB query().
 * Do not use the plugin or any browser source; caller owns real DB session. */
export function createPostgresReplayStore(db) {
  if (!db || typeof db.query !== 'function') throw new Error('POSTGRES_REPLAY_DB_REQUIRED');
  return Object.freeze({
    async claimOnce(key, expiresAt) {
      if (
        typeof key !== 'string' ||
        !key.startsWith(PREFIX) ||
        !UUID.test(key.slice(PREFIX.length)) ||
        !Number.isSafeInteger(expiresAt)
      )
        throw Error('INVALID_REPLAY_CLAIM');
      const now = Math.floor(Date.now() / 1000);
      if (expiresAt <= now || expiresAt > now + 300) throw Error('INVALID_REPLAY_EXPIRY');
      const hash = createHash('sha256').update(key).digest('hex');
      // Exactly one INSERT winner across every Jarvis worker and VPS instance.
      // On DB error we throw: upstream verifier must fail closed.
      const result = await db.query(
        'INSERT INTO public.qfj_vox_agent_replay_receipts_v1 (key_hash,expires_at) ' +
          "VALUES(decode($1, 'hex'),to_timestamp($2)) ON CONFLICT (key_hash) DO NOTHING RETURNING key_hash",
        [hash, expiresAt],
      );
      if (!result || !Array.isArray(result.rows) || result.rows.length > 1)
        throw Error('REPLAY_DB_BAD_RESPONSE');
      return result.rows.length === 1;
    },
  });
}
