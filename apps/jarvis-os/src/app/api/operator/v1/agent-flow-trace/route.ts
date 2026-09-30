import { requireApiOperatorSession } from '@/server/auth/dal';
import { readAgentFlowTracePathFromEnvironment } from '@/server/auth/config/loader';
import { readAgentFlowTraceSnapshot } from '@/server/control-plane/sources/agent-flow-trace-source';
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
    const result = await readAgentFlowTraceSnapshot(readAgentFlowTracePathFromEnvironment());
    return new Response(JSON.stringify(result), { status: 200, headers: READ_ONLY_HEADERS });
  } catch {
    return new Response(JSON.stringify(FAILURE_BODY), {
      status: 503,
      headers: READ_ONLY_HEADERS,
    });
  }
}
