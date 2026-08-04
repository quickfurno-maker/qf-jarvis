import { redirect } from 'next/navigation';

import { AppShell } from '@/components/shell/AppShell';
import { requireOperatorSession } from '@/server/auth/dal';

/**
 * The protected layout (JOS-01C, ADR-0087).
 *
 * Every operator page in Jarvis OS renders inside this. It verifies the session PROPERLY —
 * decrypting the token, checking expiry, revision and operator identity — rather than trusting
 * that the proxy already looked. The proxy is an optimistic redirect for the common case; this is
 * the authorization check, and it sits as close to the rendered data as a layout can.
 *
 * That redundancy is the point. If the proxy were removed, misconfigured, or bypassed by a routing
 * path nobody anticipated, this layout still refuses to render.
 *
 * ### Only a safe view crosses into the client
 *
 * `AppShell` is a client component, so anything handed to it is serialized into the RSC payload
 * and readable in the browser. It receives an `OperatorSessionView` — id, display name, role and
 * the two timestamps — and never the token, the session id, the key id or the session revision.
 * The CSRF token is passed separately and lands only in the logout form's hidden input.
 */
/**
 * Every protected page renders per request, never from static output.
 *
 * Without this Next prerendered all eighteen operator pages as STATIC HTML. The session check
 * still ran at build time -- where the auth configuration is absent, so it redirected -- and the
 * result was baked into `.next` as a fixed redirect that could never authenticate anyone. Worse,
 * in a build where the configuration WERE readable, protected markup would have been written to
 * disk and served without any per-request check at all.
 *
 * Authentication makes a page dynamic. Saying so explicitly means it cannot become static again
 * because some future refactor stopped Next from noticing a dynamic API call.
 */
export const dynamic = 'force-dynamic';

export default async function ProtectedLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  let session;
  try {
    session = await requireOperatorSession();
  } catch {
    // Generic: an expired session and a forged one are indistinguishable from out here, which is
    // the intended behaviour. The operator simply signs in again.
    redirect('/login');
  }

  return (
    <AppShell operator={session.view} csrfToken={session.csrfToken}>
      {children}
    </AppShell>
  );
}
