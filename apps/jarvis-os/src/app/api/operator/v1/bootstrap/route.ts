import { requireApiOperatorSession } from '@/server/auth/dal';
import { operatorBootstrap } from '@/server/operator/bootstrap';

export const dynamic = 'force-dynamic';

const headers = Object.freeze({
  'cache-control': 'no-store, private',
  'content-type': 'application/json; charset=utf-8',
});

export async function GET(request: Request): Promise<Response> {
  try {
    await requireApiOperatorSession();
  } catch {
    return new Response(JSON.stringify({ error: 'unauthenticated' }), {
      status: 401,
      headers,
    });
  }

  if (new URL(request.url).search !== '') {
    return new Response(JSON.stringify({ error: 'unsupported_query' }), {
      status: 400,
      headers,
    });
  }

  return new Response(JSON.stringify(operatorBootstrap()), {
    status: 200,
    headers,
  });
}
