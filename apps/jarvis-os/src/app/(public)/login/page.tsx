import { redirect } from 'next/navigation';

import { BrandLockup } from '@/components/shell/Brand';
import { LoginForm } from '@/components/auth/LoginForm';
import { getOptionalOperatorSession } from '@/server/auth/dal';
import { safeReturnPath } from '@/server/auth/origin/same-origin';

/**
 * `/login` — the secure-access screen (JOS-01C, ADR-0087).
 *
 * ### It renders no AppShell, and that is a security property
 *
 * Everything an unauthenticated visitor can see is on this page. The operator shell — the module
 * navigation, the agent roster, the boundary sections, the environment label — would tell someone
 * who cannot sign in exactly what this system is and what it contains. So the shell lives in the
 * protected layout and this page renders only its own panel.
 *
 * ### It says nothing about the operator
 *
 * There is no "operator not found", no hint about whether the configured id exists, and no
 * indication of which factor a failed attempt got wrong. The three messages it can show —
 * credentials not accepted, too many attempts, secure access unavailable — are the complete set.
 */
export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // An operator who is already signed in has no business on the login form.
  const session = await getOptionalOperatorSession();
  if (session !== undefined) {
    redirect('/');
  }

  const params = await searchParams;
  const errorMarker = typeof params['error'] === 'string' ? params['error'] : undefined;
  const returnTo = safeReturnPath(
    typeof params['returnTo'] === 'string' ? params['returnTo'] : '/',
  );

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-base-950)] px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-7 flex justify-center">
          <BrandLockup />
        </div>

        <div className="surface-lift rounded-[var(--radius-panel)] border border-[var(--color-line)] bg-[var(--color-base-900)] px-6 py-7">
          <h1 className="text-[17px] leading-tight font-semibold tracking-[-0.01em] text-[var(--color-ink)]">
            Secure access
          </h1>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--color-ink-muted)]">
            Private operator control plane. Owner access only.
          </p>

          <LoginForm errorMarker={errorMarker} returnTo={returnTo} />
        </div>

        {/* The boundary an operator should see BEFORE signing in, not after. */}
        <ul className="mt-5 grid grid-cols-1 gap-px overflow-hidden rounded-[var(--radius-panel)] border border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-2">
          <SecurityFact label="Production rollout" value="OFF" />
          <SecurityFact label="QuickFurno Core" value="NOT CONNECTED" />
          <SecurityFact label="n8n" value="NOT CONNECTED" />
          <SecurityFact label="Access" value="OWNER ONLY" />
        </ul>

        <p className="mt-5 text-center text-[11.5px] leading-relaxed text-[var(--color-ink-faint)]">
          Authentication permits viewing Jarvis OS. QuickFurno Core remains authoritative and
          continues to own every business decision.
        </p>
      </div>
    </main>
  );
}

function SecurityFact({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <li className="bg-[var(--color-base-900)] px-4 py-3">
      <p className="text-[10.5px] font-medium tracking-[0.06em] text-[var(--color-ink-faint)] uppercase">
        {label}
      </p>
      <p className="mt-1 text-[11.5px] font-semibold tracking-[0.03em] text-[var(--color-ink-muted)] uppercase">
        {value}
      </p>
    </li>
  );
}
