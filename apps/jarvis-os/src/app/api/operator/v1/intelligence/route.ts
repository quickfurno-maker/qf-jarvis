import { answerFromControlPlane } from '@/lib/control-plane/operator-intelligence';
import { controlPlane } from '@/lib/control-plane';
import { requireApiOperatorSession } from '@/server/auth/dal';
import { operatorBootstrap } from '@/server/operator/bootstrap';
import { READ_ONLY_HEADERS, UNAUTHENTICATED_BODY } from '@/server/control-plane/route-response';

export const dynamic = 'force-dynamic';

const INVALID_BODY = Object.freeze({
  error: 'operator-intelligence-query-invalid',
  message: 'A bounded operator question is required.',
});

const FAILURE_BODY = Object.freeze({
  error: 'operator-intelligence-unavailable',
  message: 'Jarvis operator intelligence could not produce an answer.',
});

export async function POST(request: Request): Promise<Response> {
  try {
    await requireApiOperatorSession();
  } catch {
    return new Response(JSON.stringify(UNAUTHENTICATED_BODY), {
      status: 401,
      headers: READ_ONLY_HEADERS,
    });
  }

  if (new URL(request.url).search !== '') {
    return new Response(JSON.stringify(INVALID_BODY), {
      status: 400,
      headers: READ_ONLY_HEADERS,
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify(INVALID_BODY), {
      status: 400,
      headers: READ_ONLY_HEADERS,
    });
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    typeof (body as { readonly query?: unknown }).query !== 'string'
  ) {
    return new Response(JSON.stringify(INVALID_BODY), {
      status: 400,
      headers: READ_ONLY_HEADERS,
    });
  }

  const query = (body as { readonly query: string }).query;
  if (query.trim().length === 0 || query.length > 500) {
    return new Response(JSON.stringify(INVALID_BODY), {
      status: 400,
      headers: READ_ONLY_HEADERS,
    });
  }

  try {
    const answer = answerFromControlPlane(query, await controlPlane(), operatorBootstrap());
    return new Response(JSON.stringify(answer), {
      status: 200,
      headers: READ_ONLY_HEADERS,
    });
  } catch {
    return new Response(JSON.stringify(FAILURE_BODY), {
      status: 503,
      headers: READ_ONLY_HEADERS,
    });
  }
}
