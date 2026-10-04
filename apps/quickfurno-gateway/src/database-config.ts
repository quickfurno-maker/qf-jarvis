import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import {
  createDatabaseConfig,
  type DatabaseConfig,
  type DatabaseConfigInput,
} from '@qf-jarvis/event-backbone';

const MAX_CONFIG_BYTES = 64 * 1024;
const MAX_CA_BYTES = 256 * 1024;

interface RawDatabaseConfig {
  readonly connectionString: string;
  readonly maxConnections?: number;
  readonly connectionTimeoutMillis?: number;
  readonly idleTimeoutMillis?: number;
  readonly statementTimeoutMillis?: number;
  readonly tls:
    | Readonly<{ mode: 'disabled' }>
    | Readonly<{ mode: 'verify-full'; caFile: string }>;
}

function bounded(path: string, maxBytes: number): Buffer {
  if (!isAbsolute(path)) throw new Error('gateway_database_config_invalid');
  const value = readFileSync(path);
  if (value.length < 1 || value.length > maxBytes) {
    throw new Error('gateway_database_config_invalid');
  }
  return value;
}

function parseRaw(path: string): RawDatabaseConfig {
  let value: unknown;
  try {
    value = JSON.parse(bounded(path, MAX_CONFIG_BYTES).toString('utf8'));
  } catch {
    throw new Error('gateway_database_config_invalid');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('gateway_database_config_invalid');
  }
  const row = value as Record<string, unknown>;
  const allowed = new Set([
    'connectionString',
    'maxConnections',
    'connectionTimeoutMillis',
    'idleTimeoutMillis',
    'statementTimeoutMillis',
    'tls',
  ]);
  if (Object.keys(row).some((key) => !allowed.has(key))) {
    throw new Error('gateway_database_config_invalid');
  }
  if (typeof row['connectionString'] !== 'string' || row['connectionString'].length < 1) {
    throw new Error('gateway_database_config_invalid');
  }
  const tls = row['tls'];
  if (tls === null || typeof tls !== 'object' || Array.isArray(tls)) {
    throw new Error('gateway_database_config_invalid');
  }
  const tlsRow = tls as Record<string, unknown>;
  let parsedTls: RawDatabaseConfig['tls'];
  if (tlsRow['mode'] === 'disabled' && Object.keys(tlsRow).length === 1) {
    parsedTls = Object.freeze({ mode: 'disabled' as const });
  } else if (
    tlsRow['mode'] === 'verify-full' &&
    typeof tlsRow['caFile'] === 'string' &&
    Object.keys(tlsRow).sort().join(',') === ['caFile', 'mode'].sort().join(',')
  ) {
    parsedTls = Object.freeze({ mode: 'verify-full' as const, caFile: tlsRow['caFile'] });
  } else {
    throw new Error('gateway_database_config_invalid');
  }

  const numeric = (
    key:
      | 'maxConnections'
      | 'connectionTimeoutMillis'
      | 'idleTimeoutMillis'
      | 'statementTimeoutMillis',
  ): number | undefined => {
    const candidate = row[key];
    if (candidate === undefined) return undefined;
    if (typeof candidate !== 'number' || !Number.isInteger(candidate)) {
      throw new Error('gateway_database_config_invalid');
    }
    return candidate;
  };

  return Object.freeze({
    connectionString: row['connectionString'],
    ...(numeric('maxConnections') === undefined
      ? {}
      : { maxConnections: numeric('maxConnections') }),
    ...(numeric('connectionTimeoutMillis') === undefined
      ? {}
      : { connectionTimeoutMillis: numeric('connectionTimeoutMillis') }),
    ...(numeric('idleTimeoutMillis') === undefined
      ? {}
      : { idleTimeoutMillis: numeric('idleTimeoutMillis') }),
    ...(numeric('statementTimeoutMillis') === undefined
      ? {}
      : { statementTimeoutMillis: numeric('statementTimeoutMillis') }),
    tls: parsedTls,
  }) as RawDatabaseConfig;
}

export function loadGatewayDatabaseConfig(path: string): DatabaseConfig {
  const raw = parseRaw(path);
  let tls: DatabaseConfigInput['tls'];
  if (raw.tls.mode === 'disabled') {
    tls = { mode: 'disabled' };
  } else {
    tls = {
      mode: 'verify-full',
      caCertificatePem: bounded(raw.tls.caFile, MAX_CA_BYTES).toString('utf8'),
    };
  }

  return createDatabaseConfig({
    connectionString: raw.connectionString,
    ...(raw.maxConnections === undefined ? {} : { maxConnections: raw.maxConnections }),
    ...(raw.connectionTimeoutMillis === undefined
      ? {}
      : { connectionTimeoutMillis: raw.connectionTimeoutMillis }),
    ...(raw.idleTimeoutMillis === undefined
      ? {}
      : { idleTimeoutMillis: raw.idleTimeoutMillis }),
    ...(raw.statementTimeoutMillis === undefined
      ? {}
      : { statementTimeoutMillis: raw.statementTimeoutMillis }),
    applicationName: 'qf-jarvis-gateway-turn-spool',
    tls,
  });
}
