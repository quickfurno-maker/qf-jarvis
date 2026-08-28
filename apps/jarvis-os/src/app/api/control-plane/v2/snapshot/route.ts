import { requireApiOperatorSession } from '../../../../../server/auth/dal';
import { loadControlPlaneSnapshotV2 } from '../../../../../server/control-plane/load-snapshot';
import {
  FAILURE_BODY,
  READ_ONLY_HEADERS,
  UNAUTHENTICATED_BODY,
  UNSUPPORTED_QUERY_BODY,
} from '../../../../../server/control-plane/route-response';

/**
 * `GET /api/control-plane/v2/snapshot` — the read-only operator BFF at V2 (AVG-11, ADR-0129).
 *
 * ### Why a second path rather than a changed one
 *
 * ADR-0086's change-control rule: `contractVersion` is `"1"`, and a breaking change to the snapshot
 * shape requires a new version and a superseding ADR, not an edit in place — because a shipped
 * client cannot be asked to re-parse. AVG-11 needed two breaking changes, so it got a version, and a
 * version needs somewhere to be served from.
 *
 * `/v1/snapshot` is **unchanged**: same handler, same builder, same payload, byte for byte. A client
 * built against V1 keeps working without knowing this route exists.
 *
 * ### It is the same stack, not a second one
 *
 * This route holds no logic of its own. Authentication, the query rejection, the failure body and the
 * headers are the same shared module V1 uses, and `loadControlPlaneSnapshotV2` performs the same
 * acquisition over the same observation window and the same composed core — only the final wire
 * shaping differs. There is no second control plane here, no second source of truth and no second
 * set of business rules: there is one snapshot, expressed at two versions.
 *
 * ### Only GET exists, at this version too
 *
 * There is no `POST`, `PUT`, `PATCH` or `DELETE` export in this file. In the Next.js App Router an
 * unexported method is answered with `405` by the framework, so the absence is the enforcement — a
 * mutating verb cannot be reached because no handler exists to reach. A new version is a new SHAPE,
 * never new authority.
 *
 * ### It authenticates ITSELF
 *
 * Like V1, and for the same reason: the proxy is an optimistic pre-routing check that sees a cookie
 * without decrypting it, and this handler verifies the session properly, close to the data. If the
 * proxy were deleted tomorrow this route would still return 401.
 */

/**
 * Per-request rendering.
 *
 * `generatedAt` must reflect when the response was produced, so the route must not be prerendered
 * into a static asset with one instant baked into it. This affects the ENVELOPE only:
 * `source.freshness` stays `BUILD_DECLARATION` on every call, because answering a request re-reads
 * nothing.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  // Authentication first, before any work and before any snapshot exists in memory.
  try {
    await requireApiOperatorSession();
  } catch {
    return new Response(JSON.stringify(UNAUTHENTICATED_BODY), {
      status: 401,
      headers: READ_ONLY_HEADERS,
    });
  }

  const url = new URL(request.url);
  if (url.search !== '') {
    // Reject rather than ignore: an unsupported parameter is answered exactly, and never treated as
    // a data-access instruction.
    return new Response(JSON.stringify(UNSUPPORTED_QUERY_BODY), {
      status: 400,
      headers: READ_ONLY_HEADERS,
    });
  }

  try {
    // The SAME request-scoped loader the server-rendered pages use, so the page and this route are
    // two callers of one path rather than two paths that happen to agree today.
    const snapshot = await loadControlPlaneSnapshotV2();
    return new Response(JSON.stringify(snapshot), { status: 200, headers: READ_ONLY_HEADERS });
  } catch {
    // Fail closed, and say nothing. The thrown value may name fields, paths or received values; none
    // of that belongs in a response body.
    return new Response(JSON.stringify(FAILURE_BODY), { status: 503, headers: READ_ONLY_HEADERS });
  }
}
