-- VOX-10B Jarvis postgres persistence: SOURCE ONLY; not applied anywhere.
-- Dedicated Jarvis backend DB (NOT Core/Supabase). No browser permissions.
BEGIN;
CREATE TABLE IF NOT EXISTS public.qfj_vox_agent_replay_receipts_v1(
 key_hash bytea PRIMARY KEY,
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT qfj_vox_replay_sha256_len CHECK (octet_length(key_hash)=32),
 CONSTRAINT qfj_vox_replay_expires CHECK(expires_at>consumed_at)
);
CREATE INDEX IF NOT EXISTS qfj_vox_replay_expire_idx
 ON public.qfj_vox_agent_replay_receipts_v1(expires_at);
REVOKE ALL ON public.qfj_vox_agent_replay_receipts_v1 FROM PUBLIC;
COMMIT;
