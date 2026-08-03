import { buildControlPlaneSnapshot } from '../../../../../server/control-plane/build-snapshot';
import {
  FAILURE_BODY,
  READ_ONLY_HEADERS,
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
 * ### It is not deployed
 *
 * This route has no authentication. JOS-01C adds it; JOS-01D deploys only afterwards. Nothing in
 * this phase exposes it on the VPS, through Traefik, or at any hostname.
 */

/**
 * Per-request rendering.
 *
 * The route reports `REQUEST_TIME` freshness, so it must not be prerendered into a static asset
 * with a build-time instant baked into it — that would be the exact freshness lie the contract
 * exists to prevent.
 */
export const dynamic = 'force-dynamic';

export function GET(request: Request): Response {
  // The clock is read HERE, at the boundary, and injected. The builder stays pure and
  // deterministic, which is what lets a test assert its output byte-for-byte.
  const observedAt = new Date().toISOString();

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
    const snapshot = buildControlPlaneSnapshot({ observedAt, freshness: 'REQUEST_TIME' });
    return new Response(JSON.stringify(snapshot), { status: 200, headers: READ_ONLY_HEADERS });
  } catch {
    // Fail closed, and say nothing. The thrown value may name fields, paths or received values;
    // none of that belongs in a response body. It is deliberately not logged to the console
    // either, because this application has no logging boundary yet and `no-console` is enforced.
    return new Response(JSON.stringify(FAILURE_BODY), { status: 503, headers: READ_ONLY_HEADERS });
  }
}
