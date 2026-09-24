import { requireApiOperatorSession } from '@/server/auth/dal';
import { loadControlPlaneSnapshotV2 } from '@/server/control-plane/load-snapshot';
import {
  FAILURE_BODY,
  READ_ONLY_HEADERS,
  UNAUTHENTICATED_BODY,
  UNSUPPORTED_QUERY_BODY,
} from '@/server/control-plane/route-response';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    await requireApiOperatorSession();
  } catch {
    return new Response(JSON.stringify(UNAUTHENTICATED_BODY), {
      status: 401,
      headers: READ_ONLY_HEADERS,
    });
  }

  if (new URL(request.url).search !== '') {
    return new Response(JSON.stringify(UNSUPPORTED_QUERY_BODY), {
      status: 400,
      headers: READ_ONLY_HEADERS,
    });
  }

  try {
    return new Response(JSON.stringify(await loadControlPlaneSnapshotV2()), {
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
