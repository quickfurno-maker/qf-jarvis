import { buildOperatorIntelligenceContext } from '@/lib/control-plane/operator-intelligence';
import { controlPlane } from '@/lib/control-plane';
import {
  loadAgniOperatorIngressConfig,
  readAosMarketCapacityObservationPathFromEnvironment,
  readReleaseShaFromEnvironment,
} from '@/server/auth/config/loader';
import {
  AGNI_OWNER_SNAPSHOT_RESPONSE_PROTOCOL,
  AGNI_PARENT_HEARTBEAT_RESPONSE_PROTOCOL,
  agniOwnerSnapshotResponseHeaders,
  parseAgniOwnerSnapshot,
  parseAgniParentHeartbeat,
  verifyAgniOwnerSnapshot,
} from '@/server/operator/agni-owner-snapshot';
import { readAosMarketCapacityObservation } from '@/server/control-plane/sources/aos-market-capacity-source';
import { headersToRecord } from '@/server/operator/agni-operator-query';
import { operatorBootstrap } from '@/server/operator/bootstrap';

export const dynamic = 'force-dynamic';

const GENERIC_HEADERS = Object.freeze({
  'cache-control': 'no-store, private',
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
});

function reply(
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = GENERIC_HEADERS,
): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

export async function POST(request: Request): Promise<Response> {
  if (new URL(request.url).search !== '') return reply(400, { error: 'invalid_request' });
  if (
    request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !==
    'application/json'
  ) {
    return reply(415, { error: 'invalid_request' });
  }

  let rawBody: Uint8Array;
  try {
    rawBody = new Uint8Array(await request.arrayBuffer());
  } catch {
    return reply(400, { error: 'invalid_request' });
  }

  let config;
  try {
    config = loadAgniOperatorIngressConfig();
  } catch {
    return reply(503, { error: 'operator_ingress_unavailable' });
  }

  const verified = verifyAgniOwnerSnapshot({
    headers: headersToRecord(request.headers),
    rawBody,
    verificationKeys: config.verificationKeys,
  });
  if (!verified.ok) return reply(401, { error: 'authentication_failed' });
  const challenge = parseAgniParentHeartbeat(rawBody);
  if (!parseAgniOwnerSnapshot(rawBody) && challenge === null)
    return reply(400, { error: 'invalid_request' });
  if (challenge !== null) {
    let healthy: boolean;
    try {
      await controlPlane();
      healthy = true;
    } catch {
      healthy = false;
    }
    const candidate = readReleaseShaFromEnvironment();
    const revision = candidate && /^[0-9a-f]{40}$/u.test(candidate) ? candidate : null;
    return reply(
      200,
      {
        protocol: AGNI_PARENT_HEARTBEAT_RESPONSE_PROTOCOL,
        sourceId: 'jarvis',
        authority: 'READ_ONLY',
        observedAt: new Date().toISOString(),
        releaseRevision: revision,
        challenge,
        status: !revision ? 'UNKNOWN' : healthy ? 'HEALTHY' : 'UNHEALTHY',
        scope: 'JARVIS_OS_HTTP_AND_CONTROL_PLANE_READ',
        executionAuthority: 'NONE',
      },
      agniOwnerSnapshotResponseHeaders(verified.metadata),
    );
  }

  try {
    const [plane, marketplace] = await Promise.all([
      controlPlane(),
      readAosMarketCapacityObservation(readAosMarketCapacityObservationPathFromEnvironment()),
    ]);
    const context = buildOperatorIntelligenceContext(plane, operatorBootstrap());
    return reply(
      200,
      {
        protocol: AGNI_OWNER_SNAPSHOT_RESPONSE_PROTOCOL,
        generatedAt: new Date().toISOString(),
        now: context.now,
        agents: context.agents,
        systems: context.systems,
        capabilities: context.capabilities,
        marketplace,
      },
      agniOwnerSnapshotResponseHeaders(verified.metadata),
    );
  } catch {
    return reply(
      503,
      { error: 'owner_snapshot_unavailable' },
      agniOwnerSnapshotResponseHeaders(verified.metadata),
    );
  }
}
