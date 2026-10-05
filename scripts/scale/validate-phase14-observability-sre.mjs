import { readFileSync, existsSync } from 'node:fs';

function fail(message) {
  process.stderr.write('JARVIS_PHASE14_FAIL: ' + message + '\n');
  process.exit(1);
}
const read = (path) => readFileSync(path, 'utf8');
const contract = JSON.parse(read('contracts/qfj-observability-phase14-v1.json'));
if (contract.phase !== 14 || contract.system !== 'AGNI') fail('contract identity mismatch');
if (contract.backend !== 'OTEL_COLLECTOR_PROMETHEUS_TEMPO_LOKI_GRAFANA') fail('backend mismatch');
if (contract.telemetryAuthority !== 'POWERLESS') fail('telemetry must be powerless');
if (
  contract.propagation?.format !== 'W3C Trace Context' ||
  contract.propagation?.rejectTraceIdMismatch !== true
)
  fail('W3C signed binding missing');
if (contract.governance?.humanApprovalAuthority !== 'QUICKFURNO_CORE')
  fail('Core approval authority drifted');

for (const path of [
  'packages/observability/src/index.ts',
  'packages/cross-system-scale-contract/src/contract.ts',
  'packages/cross-system-scale-contract/src/node-http.ts',
  'apps/quickfurno-gateway/src/server.ts',
  'apps/api/src/private-riya-web-ingress/create-handler.ts',
  'apps/jarvis-os/src/app/(protected)/agni/page.tsx',
  'apps/jarvis-os/src/server/agni/client.ts',
  'ops/observability/otel-agent.yaml',
  'deploy/observability/compose.agent.yml',
  'deploy/quickfurno-gateway/compose.observability.yml',
  'deploy/quickfurno-worker/compose.observability.yml',
  'packages/event-backbone/src/persistence/migrations/0020_scale_phase14_trace_context.sql',
])
  if (!existsSync(path)) fail('missing ' + path);

const contractSource = read('packages/cross-system-scale-contract/src/contract.ts');
if (!contractSource.includes('traceparent') || !contractSource.includes('x-qfj-trace-id'))
  fail('signed trace binding missing');
const transport = read('packages/cross-system-scale-contract/src/node-http.ts');
if (!transport.includes('propagation.inject') || !transport.includes('SpanKind.CLIENT'))
  fail('client W3C tracing missing');
const gateway = read('apps/quickfurno-gateway/src/server.ts');
if (
  !gateway.includes('qf.security.auth.failures') ||
  !gateway.includes('qf.security.signature.failures')
)
  fail('gateway security counters missing');
const rootTsconfig = read('tsconfig.json');
const apiBuildTsconfig = read('apps/api/tsconfig.build.json');
const gatewayBuildTsconfig = read('apps/quickfurno-gateway/tsconfig.build.json');
if (
  !rootTsconfig.includes('./packages/observability/tsconfig.build.json') ||
  !apiBuildTsconfig.includes('../../packages/observability/tsconfig.build.json') ||
  !gatewayBuildTsconfig.includes('../../packages/observability/tsconfig.build.json')
)
  fail('observability clean-build project references missing');
const productionWorkerBin = read('apps/api/src/bin/run-quickfurno-whatsapp-production-worker.ts');
if (
  productionWorkerBin.includes('process.env') ||
  !productionWorkerBin.includes("const PHASE14_MIGRATION_HEAD = '0020_scale_phase14_trace_context'")
)
  fail('production worker observability identity containment drifted');
const runtime = read('packages/observability/src/index.ts');
if (
  !runtime.includes('qf.telemetry.heartbeat.unixtime') ||
  !runtime.includes('OTEL_EXPORTER_OTLP_ENDPOINT')
)
  fail('heartbeat/OTLP runtime missing');
const agent = read('ops/observability/otel-agent.yaml');
if (
  !agent.includes('0.0.0.0:4317') ||
  !agent.includes('AGNI_OTLP_GATEWAY_ENDPOINT') ||
  !agent.includes('cert_file') ||
  !agent.includes('key_file')
)
  fail('local mTLS OTLP agent invalid');
const agentCompose = read('deploy/observability/compose.agent.yml');
const gatewayOverlay = read('deploy/quickfurno-gateway/compose.observability.yml');
const workerOverlay = read('deploy/quickfurno-worker/compose.observability.yml');
if (
  !agentCompose.includes('name: qf-jarvis-observability') ||
  !gatewayOverlay.includes('http://qf-jarvis-otel-agent:4318') ||
  !workerOverlay.includes('http://qf-jarvis-otel-agent:4318') ||
  gatewayOverlay.includes('depends_on') ||
  workerOverlay.includes('depends_on')
)
  fail('Jarvis agent topology invalid or telemetry became blocking');
for (const forbidden of [
  'compose.observability.yml',
  'prometheus.yml',
  'tempo.yaml',
  'loki.yaml',
  'otel-collector.yaml',
]) {
  if (existsSync('ops/observability/' + forbidden))
    fail('central observability ownership leaked into Jarvis: ' + forbidden);
}
const traceMigration = read(
  'packages/event-backbone/src/persistence/migrations/0020_scale_phase14_trace_context.sql',
);
const fileSpool = read('apps/quickfurno-gateway/src/durable-turn-spool.ts');
const pgSpool = read('apps/quickfurno-gateway/src/postgres-durable-turn-spool.ts');
const processor = read('apps/api/src/quickfurno-whatsapp/turn-processor.ts');
if (
  !traceMigration.includes('traceparent') ||
  !traceMigration.includes('tracestate') ||
  !fileSpool.includes('DurableTraceContextV1') ||
  !pgSpool.includes('traceContext?.traceparent') ||
  !processor.includes('extractRemoteContext') ||
  !processor.includes("'jarvis.whatsapp.turn'") ||
  !processor.includes('SpanKind.CONSUMER')
)
  fail('Jarvis durable W3C trace continuity missing');

const approvals = read('apps/jarvis-os/src/app/(protected)/approvals/page.tsx');
const controls = read('apps/jarvis-os/src/components/operator/OperatorControls.tsx');
if (
  !approvals.includes('actionFingerprint={row.actionFingerprint}') ||
  !controls.includes("kind === 'AGNI'") ||
  !controls.includes("action: 'AGNI_APPROVAL_DECIDE'") ||
  !controls.includes('actionFingerprint')
)
  fail('AGNI approval surface missing exact action binding');
const source = [
  runtime,
  transport,
  gateway,
  read('apps/api/src/private-riya-web-ingress/create-handler.ts'),
].join('\n');
if (/https?:\/\/[^\s'"]*(prometheus|tempo|loki)/iu.test(source))
  fail('application talks directly to telemetry backend');
process.stdout.write('JARVIS_PHASE14_PASS\n');
