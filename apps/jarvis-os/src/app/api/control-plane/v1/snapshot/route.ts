import { requireApiOperatorSession } from '../../../../../server/auth/dal';
import { buildControlPlaneSnapshot } from '../../../../../server/control-plane/build-snapshot';
import {
  FAILURE_BODY,
  READ_ONLY_HEADERS,
  UNAUTHENTICATED_BODY,
  UNSUPPORTED_QUERY_BODY,
} from '../../../../../server/control-plane/route-response';

/**
 * `GET /api/control-plane/v1/snapshot` — the read-only operator BFF (JOS-01B, ADR-0086).
 *
 * ### What this route is
 *
 * A backend-for-frontend over facts this repository already declares. It is **not** QuickFurno
 * Core, it is **not** business truth, and it is **not** an integration point: it reads no database,
 * calls no service, holds no credential and mutates nothing. It serves the same snapshot the
 * server-rendered pages use, from the same pure builder, so the web surface and a future
 * authenticated Android client cannot drift apart.
 *
 * ### Only GET exists
 *
 * There is no `POST`, `PUT`, `PATCH` or `DELETE` export in this file. In the Next.js App Router an
 * unexported method is answered with `405` by the framework, so the absence is the enforcement —
 * a mutating verb cannot be reached because no handler exists to reach.
 *
 * ### It authenticates ITSELF (JOS-01C)
 *
 * The Next.js proxy also gates this path, and that is not what protects it. The proxy is an
 * optimistic pre-routing check that sees a cookie without decrypting it; this handler calls
 * `requireApiOperatorSession()` and verifies the session properly, close to the data. If the proxy
 * were deleted tomorrow this route would still return 401 — which the tests prove by invoking the
 * exported handler directly, with no proxy anywhere in the picture.
 *
 * An unauthenticated caller gets `401` and a fixed body. It never gets a partial snapshot, a
 * reason, or a hint about whether a session existed and expired versus never existed at all.
 *
 * ### It is still not deployed
 *
 * JOS-01D deploys, and only after this authentication boundary is reviewed. Nothing in this phase
 * exposes the route on the VPS, through Traefik, or at any hostname.
 */

/**
 * Per-request rendering.
 *
 * `generatedAt` must reflect when the response was produced, so the route must not be prerendered
 * into a static asset with one instant baked into it. Note that this affects the ENVELOPE only:
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

  // The clock is read HERE, at the boundary, and injected. It stamps `generatedAt` -- when this
  // JSON was produced -- and NOTHING else. It does not, and must not, raise source freshness: this
  // request re-read no Git, no governance document, no QuickFurno Core and no n8n. The builder
  // derives `BUILD_DECLARATION` itself, and the contract rejects any other combination.
  const generatedAt = new Date().toISOString();

  const url = new URL(request.url);
  if (url.search !== '') {
    // Reject rather than ignore: see route-response.ts. An unsupported parameter is answered
    // exactly, and never treated as a data-access instruction.
    return new Response(JSON.stringify(UNSUPPORTED_QUERY_BODY), {
      status: 400,
      headers: READ_ONLY_HEADERS,
    });
  }

  try {
    const snapshot = buildControlPlaneSnapshot({ generatedAt });
    return new Response(JSON.stringify(snapshot), { status: 200, headers: READ_ONLY_HEADERS });
  } catch {
    // Fail closed, and say nothing. The thrown value may name fields, paths or received values;
    // none of that belongs in a response body. It is deliberately not logged to the console
    // either, because this application has no logging boundary yet and `no-console` is enforced.
    return new Response(JSON.stringify(FAILURE_BODY), { status: 503, headers: READ_ONLY_HEADERS });
  }
}
