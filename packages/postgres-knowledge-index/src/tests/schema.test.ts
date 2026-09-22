import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const SQL_URL = new URL('../migrations/0001_hybrid_knowledge_index.sql', import.meta.url);

describe('postgres knowledge index schema', () => {
  it('requires pgvector and builds both lexical and HNSW vector indexes', async () => {
    const sql = await readFile(SQL_URL, 'utf8');
    expect(sql).toContain("extname = 'vector'");
    expect(sql).toContain('pgvector 0.8.0 or newer is required');
    expect(sql).toContain('USING gin (search_tsv)');
    expect(sql).toContain('USING hnsw (embedding vector_cosine_ops)');
    expect(sql).toContain('vector(1536)');
  });

  it('keeps document versions and chunks immutable while publishing through sealed releases', async () => {
    const sql = await readFile(SQL_URL, 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS qf_jarvis_knowledge.document_version');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS qf_jarvis_knowledge.knowledge_release');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS qf_jarvis_knowledge.release_document');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS qf_jarvis_knowledge.active_release');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS qf_jarvis_knowledge.chunk');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON qf_jarvis_knowledge.document_version');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON qf_jarvis_knowledge.chunk');
    expect(sql).toContain("release_state IN ('STAGING','SEALED')");
  });

  it('denies public access and separates runtime reading from ingestor writes', async () => {
    const sql = await readFile(SQL_URL, 'utf8');
    expect(sql).toContain('REVOKE ALL ON SCHEMA qf_jarvis_knowledge FROM PUBLIC');
    expect(sql).toContain("current_user IN ('qf_jarvis_runtime','qf_jarvis_knowledge_ingestor')");
    expect(sql).toContain("current_user = 'qf_jarvis_knowledge_ingestor'");
    expect(sql).toContain('GRANT SELECT ON');
    expect(sql).toContain('GRANT SELECT, INSERT ON');
    expect(sql).toContain('qf_jarvis_knowledge.schema_migration,');
    expect(sql).toContain('qf_jarvis_knowledge.active_release');
  });

  it('indexes governance filters needed before candidate content leaves PostgreSQL', async () => {
    const sql = await readFile(SQL_URL, 'utf8');
    expect(sql).toContain('document_governance_idx');
    expect(sql).toContain('document_agent_scopes_gin');
    expect(sql).toContain('document_purposes_gin');
    expect(sql).toContain('document_topic_idx');
  });
});
