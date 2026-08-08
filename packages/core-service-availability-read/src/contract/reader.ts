/**
 * The injected Core service-availability reader (RWC-P5, ADR-0100).
 *
 * ### A port with no implementation, on purpose
 *
 * There is no adapter in this repository, and there must not be one yet. QuickFurno Core owns the
 * catalogue; the final integration handshake is a later, separately governed stage; and a reader
 * invented here would have to guess an endpoint, an auth scheme and a payload that nobody has agreed.
 *
 * This is the same move RWC-P2C made with the continuity store: declare the operation the design
 * genuinely needs, ship a deterministic fake under `./testing`, and let the slice that owns the real
 * integration satisfy it. Declaring it now is what makes the requirement visible BEFORE somebody
 * builds a surface that assumes Jarvis knows which cities are served.
 *
 * ### Why the result is `unknown`
 *
 * A typed return would look reassuring and prove nothing: the value crosses a boundary from a system
 * this repository does not compile, so its shape at runtime is a claim, not a fact. Typing it
 * `unknown` makes re-proving it through `parseCoreServiceAvailabilitySnapshotV1` the only way to use
 * it, rather than a discipline a caller might skip.
 */

/** What a reader is asked for. Tenant only — a snapshot is not about one conversation. */
export interface CoreServiceAvailabilityReadInput {
  readonly tenantId: string;
}

/**
 * Read the CURRENT Core-owned availability view.
 *
 * Asynchronous because a real implementation is a network round-trip. It may reject; the caller
 * treats an exception exactly as it treats an unusable answer, and never as "no restrictions".
 */
export interface CoreServiceAvailabilityReader {
  readCurrent(input: CoreServiceAvailabilityReadInput): Promise<unknown>;
}
