/**
 * The adapter's public shapes (QFJ-P08, ADR-0082).
 *
 * ### What an operator action is, and what it is not
 *
 * `ApprovalRequestV1` deliberately carries no approve/reject field, and `ApprovalDecisionV1` is
 * Core's answer, not Jarvis's. So a human's click needs a THIRD thing: a powerless statement of
 * intent, in transit, that nothing in Jarvis treats as authority. That is what
 * `ApprovalOperatorAction` is.
 *
 * ADR-0007 §"A button click inside Jarvis is not authorization" is the rule these types encode: it
 * is a REQUEST for authorization. Core independently validates identity, authority, current state,
 * risk policy, expiry and eligibility, and **may refuse the intent the human expressed**. A surface
 * that cannot display "the founder clicked approve and Core said no" has been built wrong.
 *
 * ### There is no permission anywhere in this file
 *
 * No `approved`, `isAuthorized`, `canExecute`, `canSend`, `communicationAuthorized`, `consentValid`
 * or `pending` field exists, and there is no field in which one could be expressed. The result is an
 * OBSERVATION of what Core recorded. An approval is not a communication authorization, and founder
 * approval does not override an opt-out.
 */
import type { ApprovalRequestV1, ApprovalDecisionV1, UtcTimestamp } from '@qf-jarvis/contracts';
import type {
  ApprovalDecisionCorrelation,
  ApprovalRequestRuntimeInput,
} from '@qf-jarvis/approval-runtime';

/**
 * The governed recommendation an ask was made about.
 *
 * Taken from the approval runtime's own input type rather than re-imported from
 * `@qf-jarvis/recommendation-runtime`. This package never computes a fingerprint or reads a binding
 * itself — it hands the source straight back to the public runtime — so a production edge to the
 * recommendation runtime would be a dependency it does not use, and a second place the shape of a
 * source could be asserted.
 */
export type ApprovalRecommendationSource = ApprovalRequestRuntimeInput['source'];

/**
 * The human actor, as the governed contract defines it.
 *
 * `humanActorSchema`, never `actorReferenceSchema`. The union's other arm is a POLICY actor, and a
 * policy is something Core applies on its own authority — it is not something a person operating a
 * screen can claim to be. Nor is there an agent arm to exclude: `@qf-jarvis/contracts` has no agent
 * variant at all, so "Jarvis approved it" is not a value that can be constructed.
 */
export type ApprovalOperatorActor = Extract<
  ApprovalDecisionV1['decidedBy'],
  { actorType: 'human' }
>;

/**
 * What one authenticated human is asking Core to do about one action.
 *
 * Three values, and each is an INTENT. There is deliberately no `AUTO_APPROVE`, `SEND`, `EXECUTE`,
 * `AUTHORIZE`, `FORCE` or `BYPASS`: every one of those would name a capability this package must not
 * have, and a value that cannot be constructed cannot be smuggled through a serializer.
 *
 * `REQUEST_CHANGES` is not a third verdict Core must model — it is a human declining THIS action as
 * proposed. Like `REJECT`, it may not come back as an approval of the selected action.
 */
export type ApprovalOperatorAction = 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES';

/**
 * A holder for whatever proves to CORE that this operator is who they claim to be.
 *
 * The proof is not a property. It cannot be read, spread, logged, compared, serialized or returned —
 * the only thing a caller can do with a holder is hand it to a transport, and the only thing the
 * transport can do is open it for the duration of one send. `JSON.stringify` of a holder yields
 * `{}`, which is the point: a submission command is serialized, and a proof that were reachable
 * from the command object would eventually be serialized with it.
 *
 * **This package does not define what the proof means.** Not a JWT, not a Supabase session, not a
 * bearer token, not a signature — those are decisions for whoever implements the transport against
 * a Core protocol that does not exist yet. What IS decided here is that Jarvis forwards a proof
 * rather than an assertion: "trust me, this is the founder" is not something Core should accept, and
 * Core validating the proof independently is what makes a compromised Jarvis unable to approve
 * itself (ADR-0002).
 */
export interface ApprovalCoreAuthorizationProof {
  /** Open the proof for exactly the duration of `operation`, and for nothing else. */
  use<T>(operation: (proof: string) => Promise<T>): Promise<T>;
}

/**
 * The injected boundary to QuickFurno Core.
 *
 * An interface, and only an interface. There is no URL, no header, no retry policy, no timeout, no
 * client and no default implementation anywhere in this package — a transport that could be
 * constructed here is a network call that could happen here. The caller owns all of that, and in
 * this PR the only implementation in the repository is a deterministic test fake.
 *
 * `send` receives the serialized command and the proof holder SEPARATELY. That separation is the
 * whole reason the proof is a holder: the command is a string that may be hashed, compared, or
 * written to a log by an implementation, and the credential is not in it.
 */
export interface ApprovalCoreTransport {
  /** Deliver one command. Resolve with Core's serialized response, or reject. */
  send(input: {
    readonly serializedCommand: string;
    readonly authorization: ApprovalCoreAuthorizationProof;
  }): Promise<string>;
}

/**
 * One authenticated human's intent about one existing ask.
 *
 * `source` and `request` are both treated as untrusted structural input and re-proved against each
 * other through the public approval runtime, exactly as the durable queue does. The caller does not
 * supply risk, authority, fingerprint, agent or summary: those live in the request, which is only
 * accepted if the runtime would have built it.
 */
export interface ApprovalCoreSubmissionInput {
  readonly source: ApprovalRecommendationSource;
  readonly request: ApprovalRequestV1;
  /** Who is asking. Structure is proved here; AUTHORITY is Core's question, not this package's. */
  readonly operator: ApprovalOperatorActor;
  readonly action: ApprovalOperatorAction;
  /** When the human acted. Must fall inside the request's own validity window. No clock is read. */
  readonly requestedAt: UtcTimestamp;
  readonly authorization: ApprovalCoreAuthorizationProof;
}

/**
 * What Core answered, and what that answer provably describes.
 *
 * Two fields, both observations. `decision` is Core's artifact verbatim; `correlation` is the public
 * approval runtime's proof that it describes this request, this recommendation and this exact action
 * content. Neither is a permission, and the proof holder is not here.
 */
export interface ApprovalCoreSubmissionResult {
  readonly decision: ApprovalDecisionV1;
  readonly correlation: ApprovalDecisionCorrelation;
}

/**
 * The Core approval submission adapter.
 *
 * One method. It does not approve, decide, persist, queue, retry, emit or execute; it serializes an
 * intent, sends it exactly once, and validates what comes back.
 */
export interface ApprovalCoreAdapter {
  submit(input: ApprovalCoreSubmissionInput): Promise<ApprovalCoreSubmissionResult>;
}
