import { z } from 'zod';

import { requireApiOperatorSession } from '@/server/auth/dal';
import {
  investigateAgni,
  proposeAgniFix,
  readAgniHealth,
  readAgniIncidents,
} from '@/server/agni/client';

export const dynamic = 'force-dynamic';

const machine = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u);
const scalar = z.union([z.string().max(160), z.number(), z.boolean()]);

const schema = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('HEALTH'),
      system: z.enum(['QUICKFURNO', 'JARVIS']),
      service: machine,
    })
    .strict(),
  z
    .object({
      operation: z.literal('INCIDENTS'),
      limit: z.number().int().min(1).max(100).optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal('INVESTIGATE'),
      system: z.enum(['QUICKFURNO', 'JARVIS']),
      service: machine,
      category: z.enum([
        'RELIABILITY',
        'SECURITY',
        'PERFORMANCE',
        'COST',
        'DEPENDENCY',
        'OBSERVABILITY',
      ]),
      severity: z.enum(['INFO', 'WARNING', 'CRITICAL', 'EMERGENCY']),
      signalType: machine,
      safeSummary: machine,
      safeFacts: z.record(machine, scalar).optional(),
      evidenceRefs: z.array(machine).max(24).optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal('PROPOSE'),
      incidentId: machine,
      facts: z.record(machine, z.union([z.string().max(160), z.number()])).default({}),
    })
    .strict(),
]);

function reply(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'cache-control': 'no-store, private',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  let session;
  try {
    session = await requireApiOperatorSession();
  } catch {
    return reply(401, { error: 'unauthenticated' });
  }
  const csrf = request.headers.get('x-qfj-csrf');
  if (!csrf || csrf !== session.csrfToken) return reply(403, { error: 'csrf_refused' });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return reply(400, { error: 'invalid_request' });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return reply(400, { error: 'invalid_request' });

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, 15_000);
  timer.unref();
  try {
    const input = parsed.data;
    let result: unknown;
    if (input.operation === 'HEALTH') {
      result = await readAgniHealth(input.system, input.service, controller.signal);
    } else if (input.operation === 'INCIDENTS') {
      result = await readAgniIncidents(input.limit ?? 50, controller.signal);
    } else if (input.operation === 'INVESTIGATE') {
      result = await investigateAgni(
        {
          system: input.system,
          service: input.service,
          category: input.category,
          severity: input.severity,
          signalType: input.signalType,
          safeSummary: input.safeSummary,
          ...(input.safeFacts === undefined ? {} : { safeFacts: input.safeFacts }),
          ...(input.evidenceRefs === undefined ? {} : { evidenceRefs: input.evidenceRefs }),
        },
        controller.signal,
      );
    } else {
      result = await proposeAgniFix(input.incidentId, input.facts, controller.signal);
    }
    return reply(200, result);
  } catch {
    return reply(503, { error: 'agni_unavailable' });
  } finally {
    clearTimeout(timer);
  }
}
