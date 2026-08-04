/**
 * The secure-access form (JOS-01C, ADR-0087).
 *
 * A plain server-rendered `<form method="post">`. No client component, no fetch, no JavaScript
 * state — which means it works with JavaScript disabled, it cannot leak a credential into a client
 * bundle, and there is no place for a token to be stashed in `localStorage`.
 *
 * ### The three messages, and only three
 *
 * `error` arrives as a marker in the query string, never as text from the server, so a redirect
 * cannot be used to render arbitrary content on this page. Each marker maps to a fixed sentence
 * here. None of them names a factor: "those credentials were not accepted" is returned for an
 * unknown operator, a wrong passphrase and a wrong code alike.
 */

const MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  invalid: 'Those credentials were not accepted.',
  'rate-limited': 'Too many attempts. Try again shortly.',
  unavailable: 'Secure access is unavailable.',
});

export function LoginForm({
  errorMarker,
  returnTo,
}: {
  readonly errorMarker: string | undefined;
  readonly returnTo: string;
}) {
  const message = errorMarker === undefined ? undefined : MESSAGES[errorMarker];

  return (
    <form method="post" action="/api/auth/login" className="mt-6 space-y-4">
      {/*
        An error SUMMARY with `aria-live`, not a per-field error. Per-field errors would have to
        say which field was wrong, which is exactly the enumeration this form refuses to provide.
      */}
      <div aria-live="polite" role="status">
        {message === undefined ? null : (
          <p className="flex items-start gap-2 rounded-[var(--radius-control)] border border-[var(--color-critical)]/35 bg-[var(--color-critical)]/10 px-3.5 py-2.5 text-[12px] leading-relaxed text-[var(--color-critical)]">
            <span
              aria-hidden="true"
              className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-critical)]"
            />
            <span>{message}</span>
          </p>
        )}
      </div>

      <Field
        id="operatorId"
        label="Operator ID"
        type="text"
        autoComplete="username"
        hint="The operator handle configured for this control plane."
      />
      <Field
        id="password"
        label="Passphrase"
        type="password"
        autoComplete="current-password"
        hint="Use a password manager. Nothing is stored in this browser."
      />
      <Field
        id="totpCode"
        label="Authenticator code"
        type="text"
        autoComplete="one-time-code"
        inputMode="numeric"
        pattern="[0-9]{6}"
        maxLength={6}
        hint="Six digits from your authenticator app."
      />

      <input type="hidden" name="returnTo" value={returnTo} />

      <button
        type="submit"
        className="w-full rounded-[var(--radius-control)] border border-[var(--color-accent)]/45 bg-[var(--color-accent-dim)] px-4 py-2.5 text-[12.5px] font-semibold tracking-[0.02em] text-[var(--color-ink)] transition-colors hover:bg-[var(--color-accent)]/25"
      >
        Sign in
      </button>
    </form>
  );
}

function Field({
  id,
  label,
  type,
  autoComplete,
  hint,
  inputMode,
  pattern,
  maxLength,
}: {
  readonly id: string;
  readonly label: string;
  readonly type: 'text' | 'password';
  readonly autoComplete: string;
  readonly hint: string;
  readonly inputMode?: 'numeric';
  readonly pattern?: string;
  readonly maxLength?: number;
}) {
  return (
    <div>
      {/* A real <label for>, not a placeholder. A placeholder disappears the moment you type. */}
      <label
        htmlFor={id}
        className="block text-[11px] font-medium tracking-[0.04em] text-[var(--color-ink-muted)] uppercase"
      >
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        required
        autoComplete={autoComplete}
        aria-describedby={`${id}-hint`}
        spellCheck={false}
        autoCapitalize="off"
        {...(inputMode === undefined ? {} : { inputMode })}
        {...(pattern === undefined ? {} : { pattern })}
        {...(maxLength === undefined ? {} : { maxLength })}
        className="mt-1.5 w-full rounded-[var(--radius-control)] border border-[var(--color-line-strong)] bg-[var(--color-base-850)] px-3 py-2.5 text-[13px] text-[var(--color-ink)] transition-colors placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-accent)]/60"
      />
      <p id={`${id}-hint`} className="mt-1 text-[11px] text-[var(--color-ink-faint)]">
        {hint}
      </p>
    </div>
  );
}
