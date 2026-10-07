import { answerFromControlPlane } from '@/lib/control-plane/operator-intelligence';
import { controlPlane } from '@/lib/control-plane';
import { loadAgniOperatorIngressConfig } from '@/server/auth/config/loader';
import {
  AGNI_OPERATOR_QUERY_RESPONSE_PROTOCOL,
  agniOperatorQueryResponseHeaders,
  headersToRecord,
  parseAgniOperatorQuery,
  verifyAgniOperatorQuery,
} from '@/server/operator/agni-operator-query';
import { operatorBootstrap } from '@/server/operator/bootstrap';

export const dynamic = 'force-dynamic';

const GENERIC_HEADERS = Object.freeze({
  'cache-control': 'no-store, private',
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
});

function reply(status: number, body: unknown, headers = GENERIC_HEADERS): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

export async function POST(request: Request): Promise<Response> {
  if (new URL(request.url).search !== '') {
    return reply(400, { error: 'invalid_request' });
  }
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

  const verified = verifyAgniOperatorQuery({
    headers: headersToRecord(request.headers),
    rawBody,
    verificationKeys: config.verificationKeys,
  });
  if (!verified.ok) {
    return reply(401, { error: 'authentication_failed' });
  }

  const query = parseAgniOperatorQuery(rawBody);
  if (query === null) {
    return reply(400, { error: 'invalid_request' });
  }

  try {
    const answer = answerFromControlPlane(query, await controlPlane(), operatorBootstrap());
    return reply(
      200,
      {
        protocol: AGNI_OPERATOR_QUERY_RESPONSE_PROTOCOL,
        answer,
      },
      agniOperatorQueryResponseHeaders(verified.metadata),
    );
  } catch {
    return reply(
      503,
      { error: 'operator_intelligence_unavailable' },
      agniOperatorQueryResponseHeaders(verified.metadata),
    );
  }
}
