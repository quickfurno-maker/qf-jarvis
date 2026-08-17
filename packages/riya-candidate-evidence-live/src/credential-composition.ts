/**
 * The credential WIRING for one run, per governed ingress (MVP-P2A.2 HF4-R5).
 *
 * ### Why this is a module and not four lines in `bin.ts`
 *
 * `main()` needs a real terminal, a real clipboard and a real provider to run, so nothing composed
 * inside it is reachable by a spec. HF3 already learned this the expensive way: the ledger choice was
 * inline, a mutation swapped the bounded ledger for the wide one, and no test could see it. A bounded
 * run whose bound is untested is not bounded — and "the smoke and the safety phase used the SAME
 * credential holder" is exactly that kind of claim. It is the whole point of clipboard mode, it is
 * invisible from outside the process, and so it is decided here where a fake seam can prove it.
 *
 * ### The two ingresses differ in one property, and it is deliberate
 *
 * TTY mode resolves TWICE, from two independently constructed one-shot sources. That is unchanged,
 * down to the construction count, because the masked resolver fails closed on a second `resolve` and
 * reusing its holder would mean holding a hand-typed key across a phase boundary that nobody asked to
 * remove.
 *
 * Clipboard mode resolves ONCE and hands back the same opaque holder afterwards. The clipboard is
 * consumed and cleared on that single read, so a second read is not merely wasteful — there would be
 * nothing left to read, and asking the owner to copy the key again is the exact cost the owner asked
 * to remove.
 *
 * ### It holds a holder, never a value
 *
 * The clipboard resolver caches the redacting `GroqApiKey` and nothing else. There is no field on this
 * closure, or on the resolver it builds, that a raw credential string can occupy — the string exists
 * for the length of one expression inside the resolver and is unreachable from here.
 */
import type {
  ClipboardCredentialResolver,
  ClipboardResolverOptions,
  ClipboardTextSource,
  MaskedSecretSource,
  SmokeCredentialDeps,
} from '@qf-jarvis/groq-staging-smoke';
import {
  createClipboardCredentialResolver,
  createMaskedTtyCredentialResolver,
} from '@qf-jarvis/groq-staging-smoke';

import type { CredentialSourceMode } from './credential-source.js';

/**
 * The run recorder slice the clipboard ingress stamps its milestones on.
 *
 * Derived from the already-exported options type rather than imported directly: the smoke package does
 * not expose that interface from its root, and widening a package surface for one internal consumer
 * would be a worse trade than deriving it — the same reasoning `smoke-diagnostics.ts` uses.
 */
export type CredentialIngressRecorderSlice = NonNullable<ClipboardResolverOptions['recorder']>;

/** The content-free clipboard ingress counters, for the run's own output. Numbers and booleans only. */
export interface ClipboardIngressCounters {
  readonly credentialClipboardReadAttempts: number;
  readonly credentialClipboardReads: number;
  readonly credentialClipboardCleared: boolean;
  readonly credentialHolderCreations: number;
  readonly credentialReuseCount: number;
}

/** What the operator needs in order to reach a credential, whichever ingress the owner selected. */
export interface CredentialComposition {
  /** Which ingress this run is using. A closed mode, echoed on the ingress line. Never a value. */
  readonly mode: CredentialSourceMode;
  /**
   * Open the ONE credential ingress the smoke will use.
   *
   * Called at most once, and only after precheck passed. It returns the credential SLICE of the smoke
   * dependencies rather than a resolved credential, because `runGroqStagingSmokeOnce` still owns the
   * gate, the single bind and the milestone stamping — handing it anything else would mean the
   * counters described an object nobody used.
   */
  readonly openSmokeCredential: () => Promise<SmokeCredentialDeps>;
  /**
   * Resolve the candidate credential against the governed opaque reference.
   *
   * TTY: a second one-shot masked read, exactly as before. Clipboard: the SAME holder the smoke
   * already used, with no second OS clipboard access and no second owner interaction.
   */
  readonly openCandidateCredential: (reference: { readonly ref: string }) => Promise<unknown>;
  /** The clipboard counters, or `undefined` for an ingress that has none. */
  readonly ingressCounters: () => ClipboardIngressCounters | undefined;
}

/** The capabilities this module is allowed to construct. Injected, so no spec touches a real one. */
export interface CredentialCompositionSeams {
  /** Build a masked terminal source. Called once per TTY read — twice across a full TTY run. */
  readonly openMaskedSource: () => MaskedSecretSource;
  /** Build the OS clipboard seam. Called at most ONCE, and only in clipboard mode. */
  readonly openClipboard: () => ClipboardTextSource;
  /** The recorder the clipboard ingress stamps its milestones on. Optional; records nothing if absent. */
  readonly recorder?: CredentialIngressRecorderSlice;
}

/**
 * Build the credential wiring for one run.
 *
 * The clipboard resolver is created LAZILY, on the first request for it, so a run that never gets past
 * preflight constructs no credential ingress at all — the ordering guarantee this operator has always
 * claimed. It is memoised, so every later phase gets the same object and therefore the same holder.
 */
export function createCredentialComposition(
  mode: CredentialSourceMode,
  seams: CredentialCompositionSeams,
): CredentialComposition {
  if (mode === 'tty') {
    return Object.freeze({
      mode,
      // The SOURCE, not a resolver: the smoke harness owns the TTY gate and builds the resolver
      // itself, exactly as it did before this module existed.
      openSmokeCredential: (): Promise<SmokeCredentialDeps> =>
        Promise.resolve({ credentialSource: seams.openMaskedSource() }),
      // Through the EXISTING masked resolver, against the governed opaque reference. A bare `readOnce`
      // would bypass the resolver's bounds, charset and one-shot guarantees and become a second
      // credential policy.
      openCandidateCredential: (reference: { readonly ref: string }): Promise<unknown> =>
        createMaskedTtyCredentialResolver(seams.openMaskedSource()).resolve(reference),
      ingressCounters: (): ClipboardIngressCounters | undefined => undefined,
    });
  }

  // ONE resolver for the whole run. Built on first use and never rebuilt, which is what makes "the
  // same holder" a structural fact rather than a convention two call sites are trusted to keep.
  let resolver: ClipboardCredentialResolver | undefined;
  const clipboardResolver = (): ClipboardCredentialResolver => {
    resolver ??= createClipboardCredentialResolver(seams.openClipboard(), {
      ...(seams.recorder === undefined ? {} : { recorder: seams.recorder }),
    });
    return resolver;
  };

  return Object.freeze({
    mode,
    // The pre-constructed resolver, not a terminal source. Clipboard mode consumes no stdin, so the
    // smoke's interactive gate does not apply to it and is not asked to.
    openSmokeCredential: (): Promise<SmokeCredentialDeps> =>
      Promise.resolve({ credentialResolver: clipboardResolver() }),
    // The SAME resolver object. It has already loaded, so this returns the cached holder without
    // touching the OS clipboard again and without constructing a second holder.
    openCandidateCredential: (reference: { readonly ref: string }): Promise<unknown> =>
      clipboardResolver().resolve(reference),
    ingressCounters: (): ClipboardIngressCounters | undefined => {
      // Reported only once the resolver exists. A run refused at preflight has no ingress to describe,
      // and inventing zeroes for it would claim a read was attempted and returned nothing.
      if (resolver === undefined) {
        return undefined;
      }
      return Object.freeze({
        credentialClipboardReadAttempts: resolver.clipboardReadAttempts(),
        credentialClipboardReads: resolver.clipboardReads(),
        credentialClipboardCleared: resolver.clipboardCleared(),
        credentialHolderCreations: resolver.holderCreations(),
        credentialReuseCount: resolver.reuses(),
      });
    },
  });
}
