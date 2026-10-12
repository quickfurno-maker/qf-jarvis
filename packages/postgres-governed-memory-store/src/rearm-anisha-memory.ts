import type { Pool } from 'pg';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/**
 * Manual staging-only second-grant checkpoint. Called ONLY after Jarvis has
 * verified fresh vendor-scoped consent from QuickFurno Core, and a separately
 * authorized owner re-enrolment operation. Never inferred from conversation.
 *
 * An earlier consent replay cannot clear a durable erase fence because Core's
 * latest GRANTED timestamp must be later than its creation. Every memory write
 * still performs fresh Core consent gating; revocation queues another purge.
 */
export async function rearmAnishaMemoryAfterFreshCoreGrant(
  pool: Pool,
  input: Readonly<{
    vendorId: string;
    consentRevision: number;
    consentUpdatedAt: string;
    consentObservedAt: string;
    ownerApprovalRef: string;
    now: string;
  }>,
): Promise<{ readonly cleared: boolean }> {
  const now = Date.parse(input.now);
  const updatedAt = Date.parse(input.consentUpdatedAt);
  const observedAt = Date.parse(input.consentObservedAt);
  if (
    !UUID.test(input.vendorId) ||
    !Number.isSafeInteger(input.consentRevision) ||
    input.consentRevision < 4 ||
    !/^[A-Za-z0-9._:-]{8,128}$/u.test(input.ownerApprovalRef) ||
    !Number.isFinite(now) ||
    !Number.isFinite(updatedAt) ||
    !Number.isFinite(observedAt) ||
    updatedAt > now ||
    observedAt > now ||
    now - observedAt > 30_000 ||
    observedAt - updatedAt > 30 * 86400_000
  ) {
    throw new TypeError('anisha-memory-rearm-grant-evidence-invalid');
  }

  const subjectKey = 'vendor|' + input.vendorId;
  const client = await pool.connect();
  let inTransaction = false;
  try {
    await client.query('BEGIN');
    inTransaction = true;
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [subjectKey]);
    const fence = await client.query<{ created_at: Date }>(
      'SELECT created_at FROM qf_jarvis_memory.anisha_erasure_fence WHERE vendor_subject_key=$1 FOR UPDATE',
      [subjectKey],
    );
    if (fence.rows.length === 0) {
      await client.query('COMMIT');
      inTransaction = false;
      return { cleared: false };
    }
    if (
      fence.rows.length !== 1 ||
      !Number.isFinite(Date.parse(String(fence.rows[0]?.created_at))) ||
      updatedAt <= Date.parse(String(fence.rows[0]?.created_at))
    ) {
      throw new TypeError('anisha-memory-rearm-requires-new-core-grant');
    }
    // Defense in depth, including any unexpected old-memory write path:
    // the fence cannot be removed while stale rows still exist.
    await client.query(
      "DELETE FROM qf_jarvis_memory.agent_memory_record WHERE owner_agent='anisha' AND $1=ANY(subject_keys)",
      [subjectKey],
    );
    const deleted = await client.query(
      'DELETE FROM qf_jarvis_memory.anisha_erasure_fence WHERE vendor_subject_key=$1',
      [subjectKey],
    );
    if (deleted.rowCount !== 1) throw new TypeError('anisha-memory-rearm-fence-conflict');
    await client.query('COMMIT');
    inTransaction = false;
    return { cleared: true };
  } catch {
    if (inTransaction) await client.query('ROLLBACK').catch(() => undefined);
    throw new TypeError('anisha-memory-rearm-unavailable');
  } finally {
    client.release();
  }
}
