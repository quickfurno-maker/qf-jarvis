import { isAbsolute } from 'node:path';

import {
  closeDatabasePool,
  createDatabasePool,
  type DatabasePool,
} from '@qf-jarvis/event-backbone';
import { startObservability } from '@qf-jarvis/observability';

import { loadGatewayConfig } from './config.js';
import { loadGatewayDatabaseConfig } from './database-config.js';
import { createFileDurableTurnSpool, type DurableTurnSpool } from './durable-turn-spool.js';
import { createPostgresDurableTurnSpool } from './postgres-durable-turn-spool.js';
import { createGatewayServer } from './server.js';

const CONFIG_ENV = 'QFJ_GATEWAY_CONFIG_FILE';
const TURN_STORE_ENV = 'QFJ_GATEWAY_TURN_STORE';
const TURN_SPOOL_ENV = 'QFJ_GATEWAY_TURN_SPOOL_DIR';
const DATABASE_CONFIG_ENV = 'QFJ_GATEWAY_DATABASE_CONFIG_FILE';
const RUNTIME_ENV_ENV = 'QFJ_RUNTIME_ENV';
const CONFIG_SCHEMA_ENV = 'QFJ_CONFIG_SCHEMA_VERSION';
const SERVICE_ID_ENV = 'QFJ_SERVICE_ID';
const HOST = '0.0.0.0';
const PORT = 3100;

if (process.env['NODE_ENV'] === 'production') {
  if (
    process.env[RUNTIME_ENV_ENV] !== 'production' ||
    process.env[CONFIG_SCHEMA_ENV] !== '1' ||
    process.env[SERVICE_ID_ENV] !== 'qf-jarvis.quickfurno-gateway'
  ) {
    throw new Error('gateway_runtime_identity_invalid');
  }
}

const configPath = process.env[CONFIG_ENV];
if (configPath === undefined || !isAbsolute(configPath)) {
  throw new Error('gateway_config_missing');
}

const turnStoreMode = process.env[TURN_STORE_ENV] ?? 'FILE';
let databasePool: DatabasePool | undefined;
let turnSpool: DurableTurnSpool;

if (turnStoreMode === 'POSTGRES') {
  const databaseConfigPath = process.env[DATABASE_CONFIG_ENV];
  if (databaseConfigPath === undefined || !isAbsolute(databaseConfigPath)) {
    throw new Error('gateway_database_config_missing');
  }
  const databaseConfig = loadGatewayDatabaseConfig(databaseConfigPath);
  databasePool = createDatabasePool(databaseConfig);
  turnSpool = createPostgresDurableTurnSpool(databasePool);
} else if (turnStoreMode === 'FILE') {
  const spoolPath = process.env[TURN_SPOOL_ENV];
  if (spoolPath === undefined || !isAbsolute(spoolPath)) {
    throw new Error('gateway_turn_spool_missing');
  }
  turnSpool = await createFileDurableTurnSpool(spoolPath);
} else {
  throw new Error('gateway_turn_store_invalid');
}

const config = loadGatewayConfig(configPath);
if (process.env['NODE_ENV'] === 'production' && config.environment !== 'production') {
  throw new Error('gateway_environment_mismatch');
}
const buildSha = process.env['QFJ_BUILD_SHA']?.trim();
const instanceId = process.env['QFJ_SERVICE_INSTANCE_ID']?.trim();
const imageSha = process.env['QFJ_IMAGE_SHA']?.trim();
const migrationHead = process.env['QFJ_MIGRATION_HEAD']?.trim();
const observability = startObservability({
  serviceName: config.serviceId,
  serviceVersion: buildSha === undefined || buildSha === '' ? 'unknown' : buildSha,
  serviceInstanceId:
    instanceId === undefined || instanceId === '' ? `${config.serviceId}:unknown` : instanceId,
  environment: config.environment,
  imageSha: imageSha === undefined || imageSha === '' ? 'unknown' : imageSha,
  migrationHead: migrationHead === undefined || migrationHead === '' ? 'unknown' : migrationHead,
  configSchemaVersion: String(config.schemaVersion),
});
const server = createGatewayServer({ config, turnSpool });

server.listen(PORT, HOST, () => {
  process.stdout.write(`qf-jarvis-gateway listening turnStore=${turnStoreMode}\n`);
});

let stopping = false;
function stop(): void {
  if (stopping) return;
  stopping = true;
  server.close((error) => {
    void (async () => {
      try {
        if (databasePool !== undefined) await closeDatabasePool(databasePool);
      } finally {
        await observability.shutdown().catch(() => undefined);
        process.exit(error === undefined ? 0 : 1);
      }
    })();
  });
}

process.once('SIGTERM', stop);
process.once('SIGINT', stop);
