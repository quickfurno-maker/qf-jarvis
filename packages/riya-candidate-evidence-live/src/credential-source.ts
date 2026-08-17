/**
 * The closed credential-INGRESS vocabulary (MVP-P2A.2 HF4-R5).
 *
 * ### A mode, never a carrier
 *
 * Every member here names WHERE the operator will put the credential. None of them can carry one, and
 * that is the property worth stating out loud: the command grew a credential-related flag for the
 * first time, and the whole reason it is safe is that its value set is two literals decided at review
 * time. There is no `--credential`, no `--api-key`, no `--key`, no path, and no environment name,
 * because each of those is a flag whose VALUE is the secret — which puts it in shell history, in a
 * process listing, and in whatever recorded the terminal.
 *
 * ### Why the clipboard is explicit
 *
 * `tty` remains the default and absence still means it, so every existing command line behaves exactly
 * as it did. Reading an operator's clipboard is a thing a tool must be TOLD to do: a run that silently
 * consumed whatever happened to be copied would be surprising in the one direction that matters, and
 * clipboard mode consumes the clipboard rather than merely inspecting it.
 */
export const CREDENTIAL_SOURCE_MODES = ['tty', 'clipboard'] as const;
export type CredentialSourceMode = (typeof CREDENTIAL_SOURCE_MODES)[number];

/** The ingress a run has when nobody said. The masked terminal, exactly as before HF4-R5. */
export const DEFAULT_CREDENTIAL_SOURCE_MODE: CredentialSourceMode = 'tty';

/** Narrow an arbitrary argument value onto the closed set. Unknown spellings are refused, never mapped. */
export function isCredentialSourceMode(value: string): value is CredentialSourceMode {
  return (CREDENTIAL_SOURCE_MODES as readonly string[]).includes(value);
}
