/**
 * The narrow dependency contracts the JF-5B CLI injects, and nothing more.
 *
 * Each one wraps a capability that already exists somewhere else, so that the CLI can be driven by a
 * spec with no terminal and no network while production wires the real thing at the `bin` boundary.
 *
 * None of these is a provider router. Which provider serves a turn is decided by the QF Model Gateway,
 * and nothing in this file can influence it.
 */
import type { GroqApiKey, NaraApiKey } from '@qf-jarvis/model-gateway';

/** Phase 1, wrapping the EXISTING one-shot Groq staging smoke. */
export interface GroqConnectivityCheck {
  run(input: {
    /** The non-secret config path the existing `loadSmokeConfig` contract requires. */
    readonly smokeConfigPath: string;
    /** Reserve the one call against the run ledger. `false` means the ceiling refused it. */
    readonly reserve: () => boolean;
  }): Promise<
    | {
        readonly ok: true;
        /**
         * The SAME holder the connectivity check resolved, handed on for the certification phases.
         *
         * The masked resolver admits exactly one entry per process and refuses a second, so a run that
         * asked for the Groq key again would either prompt the owner twice for one secret or fail
         * closed halfway through. Returning the holder keeps it to ONE prompt — and it is a holder, not
         * a string: `toString`, `toJSON` and the Node inspect hook all return the redaction marker, so
         * carrying it one boundary further cannot put a key in a log.
         */
        readonly key: GroqApiKey;
      }
    | { readonly ok: false; readonly reason: string }
  >;
}

/** Phase 2, wrapping the existing masked-TTY ingress and the provider's redacting key holder. */
export interface NaraCredentialGate {
  read(): Promise<
    | { readonly ok: true; readonly key: NaraApiKey }
    | { readonly ok: false; readonly failure: string }
  >;
}
