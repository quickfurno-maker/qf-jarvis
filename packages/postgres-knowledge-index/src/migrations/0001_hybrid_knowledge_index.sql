DO $$
DECLARE
  vector_version text;
  vector_major integer;
  vector_minor integer;
BEGIN
  SELECT extversion INTO vector_version FROM pg_extension WHERE extname = 'vector';
  IF vector_version IS NULL THEN
    RAISE EXCEPTION 'pgvector extension must be enabled before knowledge-index migration';
  END IF;

  vector_major := split_part(vector_version, '.', 1)::integer;
  vector_minor := split_part(vector_version, '.', 2)::integer;
  IF vector_major < 1 AND vector_minor < 8 THEN
    RAISE EXCEPTION 'pgvector 0.8.0 or newer is required, found %', vector_version;
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS qf_jarvis_knowledge;
REVOKE ALL ON SCHEMA qf_jarvis_knowledge FROM PUBLIC;

SET LOCAL search_path = qf_jarvis_knowledge, extensions, public, pg_catalog;

CREATE TABLE IF NOT EXISTS qf_jarvis_knowledge.schema_migration (
  version integer PRIMARY KEY,
  filename text NOT NULL,
  checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS qf_jarvis_knowledge.index_metadata (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  embedding_dimension integer NOT NULL CHECK (embedding_dimension = 1536),
  embedding_model_ref text NOT NULL CHECK (char_length(embedding_model_ref) BETWEEN 1 AND 256),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS qf_jarvis_knowledge.document_version (
  knowledge_id text NOT NULL CHECK (
    char_length(knowledge_id) BETWEEN 1 AND 128
    AND knowledge_id ~ '^[A-Za-z0-9._:-]+$'
  ),
  version integer NOT NULL CHECK (version BETWEEN 1 AND 1000000),
  topic text NOT NULL CHECK (
    char_length(topic) BETWEEN 1 AND 128
    AND topic ~ '^[A-Za-z0-9._:-]+$'
  ),
  source_layer text NOT NULL CHECK (
    source_layer IN ('BUSINESS_DOCUMENT','POLICY_FAQ','STRUCTURED_DATA')
  ),
  source_type text NOT NULL,
  authority_tier text NOT NULL,
  content_format text NOT NULL CHECK (content_format IN ('PLAIN_TEXT','MARKDOWN')),
  content_digest text NOT NULL CHECK (content_digest ~ '^[0-9a-f]{64}$'),
  governance_digest text NOT NULL CHECK (governance_digest ~ '^[0-9a-f]{64}$'),
  source_ref text NOT NULL CHECK (char_length(source_ref) BETWEEN 1 AND 256),
  source_revision text NOT NULL CHECK (char_length(source_revision) BETWEEN 1 AND 128),
  owner_ref text NOT NULL CHECK (
    char_length(owner_ref) BETWEEN 1 AND 128
    AND owner_ref ~ '^[A-Za-z0-9._:-]+$'
  ),
  approved_by text,
  approved_at timestamptz,
  effective_from timestamptz NOT NULL,
  expires_at timestamptz,
  classification text NOT NULL CHECK (
    classification IN ('HOSTED_ALLOWED','LOCAL_ONLY','HUMAN_ONLY')
  ),
  lifecycle_state text NOT NULL CHECK (
    lifecycle_state IN ('UPLOADED','SCANNED','REVIEWED','APPROVED','ACTIVE','RETIRED')
  ),
  tenant_scope text NOT NULL CHECK (
    char_length(tenant_scope) BETWEEN 1 AND 128
    AND tenant_scope ~ '^[A-Za-z0-9._:-]+$'
  ),
  allowed_agent_scopes text[] NOT NULL CHECK (
    cardinality(allowed_agent_scopes) BETWEEN 1 AND 5
  ),
  allowed_purposes text[] NOT NULL CHECK (
    cardinality(allowed_purposes) BETWEEN 1 AND 9
  ),
  superseded_by_knowledge_id text,
  superseded_by_version integer,
  subject_ref text,
  chunk_count integer NOT NULL CHECK (chunk_count BETWEEN 1 AND 100000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (knowledge_id, version),
  CHECK ((superseded_by_knowledge_id IS NULL) = (superseded_by_version IS NULL))
);

CREATE TABLE IF NOT EXISTS qf_jarvis_knowledge.chunk (
  chunk_id text PRIMARY KEY CHECK (
    char_length(chunk_id) BETWEEN 1 AND 128
    AND chunk_id ~ '^[A-Za-z0-9._:-]+$'
  ),
  knowledge_id text NOT NULL,
  version integer NOT NULL,
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  heading_path text[] NOT NULL DEFAULT '{}',
  source_start integer NOT NULL CHECK (source_start >= 0),
  source_end integer NOT NULL CHECK (source_end >= source_start),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 20000),
  content_digest text NOT NULL CHECK (content_digest ~ '^[0-9a-f]{64}$'),
  embedding vector(1536) NOT NULL,
  embedding_model_ref text NOT NULL CHECK (char_length(embedding_model_ref) BETWEEN 1 AND 256),
  search_tsv tsvector NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (knowledge_id, version)
    REFERENCES qf_jarvis_knowledge.document_version (knowledge_id, version),
  UNIQUE (knowledge_id, version, chunk_index)
);

CREATE TABLE IF NOT EXISTS qf_jarvis_knowledge.knowledge_release (
  revision text PRIMARY KEY CHECK (
    char_length(revision) BETWEEN 1 AND 128
    AND revision ~ '^[A-Za-z0-9._:-]+$'
    AND lower(revision) <> 'latest'
    AND revision <> '*'
  ),
  embedding_model_ref text NOT NULL CHECK (char_length(embedding_model_ref) BETWEEN 1 AND 256),
  release_state text NOT NULL DEFAULT 'STAGING' CHECK (release_state IN ('STAGING','SEALED')),
  document_count integer NOT NULL DEFAULT 0 CHECK (document_count >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  sealed_at timestamptz,
  CHECK (
    (release_state = 'STAGING' AND sealed_at IS NULL)
    OR
    (release_state = 'SEALED' AND sealed_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS qf_jarvis_knowledge.release_document (
  revision text NOT NULL,
  knowledge_id text NOT NULL,
  version integer NOT NULL,
  added_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (revision, knowledge_id),
  FOREIGN KEY (revision)
    REFERENCES qf_jarvis_knowledge.knowledge_release (revision),
  FOREIGN KEY (knowledge_id, version)
    REFERENCES qf_jarvis_knowledge.document_version (knowledge_id, version)
);

CREATE TABLE IF NOT EXISTS qf_jarvis_knowledge.active_release (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision text NOT NULL,
  activated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (revision)
    REFERENCES qf_jarvis_knowledge.knowledge_release (revision)
);

CREATE OR REPLACE FUNCTION qf_jarvis_knowledge.materialize_chunk_search()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.search_tsv :=
    setweight(to_tsvector('simple', coalesce(array_to_string(NEW.heading_path, ' '), '')), 'A') ||
    setweight(to_tsvector('simple', NEW.content), 'B');
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS chunk_search_materialize ON qf_jarvis_knowledge.chunk;
CREATE TRIGGER chunk_search_materialize
BEFORE INSERT ON qf_jarvis_knowledge.chunk
FOR EACH ROW EXECUTE FUNCTION qf_jarvis_knowledge.materialize_chunk_search();

CREATE OR REPLACE FUNCTION qf_jarvis_knowledge.reject_immutable_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'knowledge index immutable row';
END
$$;

DROP TRIGGER IF EXISTS document_version_immutable ON qf_jarvis_knowledge.document_version;
CREATE TRIGGER document_version_immutable
BEFORE UPDATE OR DELETE ON qf_jarvis_knowledge.document_version
FOR EACH ROW EXECUTE FUNCTION qf_jarvis_knowledge.reject_immutable_change();

DROP TRIGGER IF EXISTS chunk_immutable ON qf_jarvis_knowledge.chunk;
CREATE TRIGGER chunk_immutable
BEFORE UPDATE OR DELETE ON qf_jarvis_knowledge.chunk
FOR EACH ROW EXECUTE FUNCTION qf_jarvis_knowledge.reject_immutable_change();

DROP TRIGGER IF EXISTS release_document_immutable ON qf_jarvis_knowledge.release_document;
CREATE TRIGGER release_document_immutable
BEFORE UPDATE OR DELETE ON qf_jarvis_knowledge.release_document
FOR EACH ROW EXECUTE FUNCTION qf_jarvis_knowledge.reject_immutable_change();

CREATE OR REPLACE FUNCTION qf_jarvis_knowledge.guard_release_document_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  release_row qf_jarvis_knowledge.knowledge_release%ROWTYPE;
  document_row qf_jarvis_knowledge.document_version%ROWTYPE;
  index_model text;
BEGIN
  SELECT * INTO release_row
    FROM qf_jarvis_knowledge.knowledge_release
   WHERE revision = NEW.revision
   FOR SHARE;

  IF NOT FOUND OR release_row.release_state <> 'STAGING' THEN
    RAISE EXCEPTION 'release document requires a STAGING release';
  END IF;

  SELECT * INTO document_row
    FROM qf_jarvis_knowledge.document_version
   WHERE knowledge_id = NEW.knowledge_id
     AND version = NEW.version;

  IF NOT FOUND
     OR document_row.lifecycle_state <> 'ACTIVE'
     OR document_row.superseded_by_knowledge_id IS NOT NULL THEN
    RAISE EXCEPTION 'release document must reference an unsuperseded ACTIVE version';
  END IF;

  SELECT embedding_model_ref INTO index_model
    FROM qf_jarvis_knowledge.index_metadata
   WHERE singleton = true;

  IF index_model IS NULL OR index_model <> release_row.embedding_model_ref THEN
    RAISE EXCEPTION 'release embedding model mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM qf_jarvis_knowledge.chunk c
     WHERE c.knowledge_id = NEW.knowledge_id
       AND c.version = NEW.version
       AND c.embedding_model_ref <> release_row.embedding_model_ref
  ) THEN
    RAISE EXCEPTION 'document chunk embedding model mismatch';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS release_document_insert_guard ON qf_jarvis_knowledge.release_document;
CREATE TRIGGER release_document_insert_guard
BEFORE INSERT ON qf_jarvis_knowledge.release_document
FOR EACH ROW EXECUTE FUNCTION qf_jarvis_knowledge.guard_release_document_insert();

CREATE OR REPLACE FUNCTION qf_jarvis_knowledge.guard_release_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  actual_count integer;
BEGIN
  IF OLD.revision <> NEW.revision
     OR OLD.embedding_model_ref <> NEW.embedding_model_ref
     OR OLD.created_at <> NEW.created_at THEN
    RAISE EXCEPTION 'knowledge release identity is immutable';
  END IF;

  IF OLD.release_state = 'SEALED' THEN
    RAISE EXCEPTION 'sealed knowledge release is immutable';
  END IF;

  IF NEW.release_state <> 'SEALED' OR NEW.sealed_at IS NULL THEN
    RAISE EXCEPTION 'only STAGING to SEALED is permitted';
  END IF;

  SELECT count(*)::integer INTO actual_count
    FROM qf_jarvis_knowledge.release_document
   WHERE revision = NEW.revision;

  IF actual_count < 1 OR NEW.document_count <> actual_count THEN
    RAISE EXCEPTION 'release document count mismatch';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS knowledge_release_update_guard ON qf_jarvis_knowledge.knowledge_release;
CREATE TRIGGER knowledge_release_update_guard
BEFORE UPDATE ON qf_jarvis_knowledge.knowledge_release
FOR EACH ROW EXECUTE FUNCTION qf_jarvis_knowledge.guard_release_update();

DROP TRIGGER IF EXISTS knowledge_release_delete_guard ON qf_jarvis_knowledge.knowledge_release;
CREATE TRIGGER knowledge_release_delete_guard
BEFORE DELETE ON qf_jarvis_knowledge.knowledge_release
FOR EACH ROW EXECUTE FUNCTION qf_jarvis_knowledge.reject_immutable_change();

CREATE OR REPLACE FUNCTION qf_jarvis_knowledge.guard_active_release()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  release_row qf_jarvis_knowledge.knowledge_release%ROWTYPE;
BEGIN
  SELECT * INTO release_row
    FROM qf_jarvis_knowledge.knowledge_release
   WHERE revision = NEW.revision;

  IF NOT FOUND OR release_row.release_state <> 'SEALED' THEN
    RAISE EXCEPTION 'active release must reference a SEALED release';
  END IF;

  NEW.singleton := true;
  NEW.activated_at := clock_timestamp();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS active_release_guard ON qf_jarvis_knowledge.active_release;
CREATE TRIGGER active_release_guard
BEFORE INSERT OR UPDATE ON qf_jarvis_knowledge.active_release
FOR EACH ROW EXECUTE FUNCTION qf_jarvis_knowledge.guard_active_release();

CREATE INDEX IF NOT EXISTS document_topic_idx
  ON qf_jarvis_knowledge.document_version (topic, knowledge_id, version);
CREATE INDEX IF NOT EXISTS document_governance_idx
  ON qf_jarvis_knowledge.document_version
    (lifecycle_state, effective_from, expires_at, classification, tenant_scope);
CREATE INDEX IF NOT EXISTS document_agent_scopes_gin
  ON qf_jarvis_knowledge.document_version USING gin (allowed_agent_scopes);
CREATE INDEX IF NOT EXISTS document_purposes_gin
  ON qf_jarvis_knowledge.document_version USING gin (allowed_purposes);
CREATE INDEX IF NOT EXISTS chunk_search_gin
  ON qf_jarvis_knowledge.chunk USING gin (search_tsv);
CREATE INDEX IF NOT EXISTS chunk_embedding_hnsw
  ON qf_jarvis_knowledge.chunk USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 128);
CREATE INDEX IF NOT EXISTS chunk_parent_idx
  ON qf_jarvis_knowledge.chunk (knowledge_id, version, chunk_index);
CREATE INDEX IF NOT EXISTS chunk_digest_idx
  ON qf_jarvis_knowledge.chunk (content_digest);
CREATE INDEX IF NOT EXISTS release_document_lookup_idx
  ON qf_jarvis_knowledge.release_document (revision, knowledge_id, version);

ALTER TABLE qf_jarvis_knowledge.schema_migration ENABLE ROW LEVEL SECURITY;
ALTER TABLE qf_jarvis_knowledge.index_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE qf_jarvis_knowledge.document_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE qf_jarvis_knowledge.chunk ENABLE ROW LEVEL SECURITY;
ALTER TABLE qf_jarvis_knowledge.knowledge_release ENABLE ROW LEVEL SECURITY;
ALTER TABLE qf_jarvis_knowledge.release_document ENABLE ROW LEVEL SECURITY;
ALTER TABLE qf_jarvis_knowledge.active_release ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS runtime_select_migrations ON qf_jarvis_knowledge.schema_migration;
CREATE POLICY runtime_select_migrations ON qf_jarvis_knowledge.schema_migration
  FOR SELECT USING (current_user IN ('qf_jarvis_runtime','qf_jarvis_knowledge_ingestor'));

DROP POLICY IF EXISTS runtime_select_metadata ON qf_jarvis_knowledge.index_metadata;
CREATE POLICY runtime_select_metadata ON qf_jarvis_knowledge.index_metadata
  FOR SELECT USING (current_user IN ('qf_jarvis_runtime','qf_jarvis_knowledge_ingestor'));
DROP POLICY IF EXISTS ingestor_insert_metadata ON qf_jarvis_knowledge.index_metadata;
CREATE POLICY ingestor_insert_metadata ON qf_jarvis_knowledge.index_metadata
  FOR INSERT WITH CHECK (current_user = 'qf_jarvis_knowledge_ingestor');

DROP POLICY IF EXISTS runtime_select_documents ON qf_jarvis_knowledge.document_version;
CREATE POLICY runtime_select_documents ON qf_jarvis_knowledge.document_version
  FOR SELECT USING (current_user IN ('qf_jarvis_runtime','qf_jarvis_knowledge_ingestor'));
DROP POLICY IF EXISTS ingestor_insert_documents ON qf_jarvis_knowledge.document_version;
CREATE POLICY ingestor_insert_documents ON qf_jarvis_knowledge.document_version
  FOR INSERT WITH CHECK (current_user = 'qf_jarvis_knowledge_ingestor');

DROP POLICY IF EXISTS runtime_select_chunks ON qf_jarvis_knowledge.chunk;
CREATE POLICY runtime_select_chunks ON qf_jarvis_knowledge.chunk
  FOR SELECT USING (current_user IN ('qf_jarvis_runtime','qf_jarvis_knowledge_ingestor'));
DROP POLICY IF EXISTS ingestor_insert_chunks ON qf_jarvis_knowledge.chunk;
CREATE POLICY ingestor_insert_chunks ON qf_jarvis_knowledge.chunk
  FOR INSERT WITH CHECK (current_user = 'qf_jarvis_knowledge_ingestor');

DROP POLICY IF EXISTS runtime_select_releases ON qf_jarvis_knowledge.knowledge_release;
CREATE POLICY runtime_select_releases ON qf_jarvis_knowledge.knowledge_release
  FOR SELECT USING (current_user IN ('qf_jarvis_runtime','qf_jarvis_knowledge_ingestor'));
DROP POLICY IF EXISTS ingestor_insert_releases ON qf_jarvis_knowledge.knowledge_release;
CREATE POLICY ingestor_insert_releases ON qf_jarvis_knowledge.knowledge_release
  FOR INSERT WITH CHECK (current_user = 'qf_jarvis_knowledge_ingestor');
DROP POLICY IF EXISTS ingestor_update_releases ON qf_jarvis_knowledge.knowledge_release;
CREATE POLICY ingestor_update_releases ON qf_jarvis_knowledge.knowledge_release
  FOR UPDATE
  USING (current_user = 'qf_jarvis_knowledge_ingestor')
  WITH CHECK (current_user = 'qf_jarvis_knowledge_ingestor');

DROP POLICY IF EXISTS runtime_select_release_documents ON qf_jarvis_knowledge.release_document;
CREATE POLICY runtime_select_release_documents ON qf_jarvis_knowledge.release_document
  FOR SELECT USING (current_user IN ('qf_jarvis_runtime','qf_jarvis_knowledge_ingestor'));
DROP POLICY IF EXISTS ingestor_insert_release_documents ON qf_jarvis_knowledge.release_document;
CREATE POLICY ingestor_insert_release_documents ON qf_jarvis_knowledge.release_document
  FOR INSERT WITH CHECK (current_user = 'qf_jarvis_knowledge_ingestor');

DROP POLICY IF EXISTS runtime_select_active_release ON qf_jarvis_knowledge.active_release;
CREATE POLICY runtime_select_active_release ON qf_jarvis_knowledge.active_release
  FOR SELECT USING (current_user IN ('qf_jarvis_runtime','qf_jarvis_knowledge_ingestor'));
DROP POLICY IF EXISTS ingestor_write_active_release ON qf_jarvis_knowledge.active_release;
CREATE POLICY ingestor_write_active_release ON qf_jarvis_knowledge.active_release
  FOR ALL
  USING (current_user = 'qf_jarvis_knowledge_ingestor')
  WITH CHECK (current_user = 'qf_jarvis_knowledge_ingestor');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qf_jarvis_runtime') THEN
    GRANT USAGE ON SCHEMA qf_jarvis_knowledge TO qf_jarvis_runtime;
    GRANT SELECT ON
      qf_jarvis_knowledge.schema_migration,
      qf_jarvis_knowledge.index_metadata,
      qf_jarvis_knowledge.document_version,
      qf_jarvis_knowledge.chunk,
      qf_jarvis_knowledge.knowledge_release,
      qf_jarvis_knowledge.release_document,
      qf_jarvis_knowledge.active_release
    TO qf_jarvis_runtime;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qf_jarvis_knowledge_ingestor') THEN
    GRANT USAGE ON SCHEMA qf_jarvis_knowledge TO qf_jarvis_knowledge_ingestor;
    GRANT SELECT, INSERT ON
      qf_jarvis_knowledge.schema_migration,
      qf_jarvis_knowledge.index_metadata,
      qf_jarvis_knowledge.document_version,
      qf_jarvis_knowledge.chunk,
      qf_jarvis_knowledge.release_document
    TO qf_jarvis_knowledge_ingestor;
    GRANT SELECT, INSERT, UPDATE ON
      qf_jarvis_knowledge.knowledge_release,
      qf_jarvis_knowledge.active_release
    TO qf_jarvis_knowledge_ingestor;
  END IF;
END
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA qf_jarvis_knowledge FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA qf_jarvis_knowledge FROM PUBLIC;
