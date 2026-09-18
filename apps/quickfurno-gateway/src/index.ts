import { isAbsolute } from 'node:path';

import { loadGatewayConfig } from './config.js';
import { createGatewayServer } from './server.js';

const CONFIG_ENV = 'QFJ_GATEWAY_CONFIG_FILE';
const HOST = '0.0.0.0';
const PORT = 3100;

const configPath = process.env[CONFIG_ENV];
if (configPath === undefined || !isAbsolute(configPath)) {
  throw new Error('gateway_config_missing');
}

const config = loadGatewayConfig(configPath);
const server = createGatewayServer({ config });

server.listen(PORT, HOST, () => {
  process.stdout.write('qf-jarvis-gateway listening\n');
});

function stop(): void {
  server.close((error) => {
    process.exit(error === undefined ? 0 : 1);
  });
}

process.once('SIGTERM', stop);
process.once('SIGINT', stop);
