import {
  OPERATOR_COMMAND_PROTOCOL,
  operatorCommandResultSchema,
  operatorCommandSchema,
} from '@qf-jarvis/operator-api-contract';

import { requireApiOperatorSession } from '@/server/auth/dal';
import { operatorBootstrap } from '@/server/operator/bootstrap';

export const dynamic = 'force-dynamic';

const JSON_HEADERS = Object.freeze({
  'cache-control': 'no-store, private',
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
});

function reply(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}

export async function POST(request: Request): Promise<Response> {
  let session;
  try {
    session = await requireApiOperatorSession();
  } catch {
    return reply(401, { error: 'unauthenticated' });
  }

  const csrf = request.headers.get('x-qfj-csrf');
  if (!csrf || csrf !== session.csrfToken) {
    return reply(403, { error: 'csrf_refused' });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return reply(400, { error: 'invalid_request' });
  }

  const parsed = operatorCommandSchema.safeParse(raw);
  if (!parsed.success) {
    return reply(400, { error: 'invalid_request' });
  }

  const issuedAt = Date.parse(parsed.data.issuedAt);
  if (!Number.isFinite(issuedAt) || Math.abs(Date.now() - issuedAt) > 60_000) {
    return reply(409, {
      protocol: OPERATOR_COMMAND_PROTOCOL,
      commandId: parsed.data.commandId,
      status: 'CONFLICT',
      authorized: false,
      reasonCode: 'COMMAND_STALE',
    });
  }

  const capability = operatorBootstrap().capabilities.find(
    (item) => item.action === parsed.data.action,
  );
  if (!capability || capability.state !== 'AVAILABLE') {
    const result = operatorCommandResultSchema.parse({
      protocol: OPERATOR_COMMAND_PROTOCOL,
      commandId: parsed.data.commandId,
      status: capability?.state === 'LOCKED' ? 'REFUSED' : 'UNAVAILABLE',
      authorized: false,
      reasonCode: capability?.state === 'LOCKED' ? 'AUTHORITY_LOCKED' : 'BRIDGE_NOT_CONNECTED',
    });
    return reply(capability?.state === 'LOCKED' ? 403 : 503, result);
  }

  const result = operatorCommandResultSchema.parse({
    protocol: OPERATOR_COMMAND_PROTOCOL,
    commandId: parsed.data.commandId,
    status: 'UNAVAILABLE',
    authorized: false,
    reasonCode: 'COMMAND_BRIDGE_NOT_IMPLEMENTED',
  });
  return reply(503, result);
}
