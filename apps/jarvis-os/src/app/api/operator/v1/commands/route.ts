import {
  OPERATOR_COMMAND_PROTOCOL,
  operatorCommandResultSchema,
  operatorCommandSchema,
} from '@qf-jarvis/operator-api-contract';

import { requireApiOperatorSession } from '@/server/auth/dal';
import { operatorBootstrap } from '@/server/operator/bootstrap';
import { submitQuickFurnoOperatorCommand } from '@/server/operator/quickfurno-command';

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
    return reply(409, operatorCommandResultSchema.parse({
      protocol: OPERATOR_COMMAND_PROTOCOL,
      commandId: parsed.data.commandId,
      status: 'CONFLICT',
      jarvisAuthorized: false,
      reasonCode: 'COMMAND_STALE',
    }));
  }

  const capability = operatorBootstrap().capabilities.find(
    (item) => item.action === parsed.data.action,
  );
  if (!capability || capability.state !== 'AVAILABLE') {
    const result = operatorCommandResultSchema.parse({
      protocol: OPERATOR_COMMAND_PROTOCOL,
      commandId: parsed.data.commandId,
      status: capability?.state === 'LOCKED' ? 'REFUSED' : 'UNAVAILABLE',
      jarvisAuthorized: false,
      reasonCode: capability?.state === 'LOCKED' ? 'AUTHORITY_LOCKED' : 'BRIDGE_NOT_CONNECTED',
    });
    return reply(capability?.state === 'LOCKED' ? 403 : 503, result);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, 5_000);
  try {
    const result = await submitQuickFurnoOperatorCommand(
      parsed.data,
      session.view.operatorId,
      controller.signal,
    );
    const status =
      result.status === 'APPLIED_BY_AUTHORITY'
        ? 200
        : result.status === 'SUBMITTED_TO_AUTHORITY'
          ? 202
          : result.status === 'CONFLICT'
            ? 409
            : result.status === 'REFUSED'
              ? 403
              : 503;
    return reply(status, result);
  } catch {
    return reply(503, operatorCommandResultSchema.parse({
      protocol: OPERATOR_COMMAND_PROTOCOL,
      commandId: parsed.data.commandId,
      status: 'UNAVAILABLE',
      jarvisAuthorized: false,
      reasonCode: 'COMMAND_BRIDGE_UNAVAILABLE',
    }));
  } finally {
    clearTimeout(timer);
  }
}
