/**
 * The provider-neutral instruction inventory (AS3A, ADR-0143 §8).
 *
 * ### One instruction layer, two families
 *
 * GPT and Claude are given the SAME words for the same role. That is the point of the locked
 * cross-review strategy: if each family had its own prompt, a quality difference between them would
 * be uninterpretable — nobody could say whether the model differed or the instruction did. Family
 * shows up in the config inventory and in the API binding, never in what the model is told to do.
 *
 * ### Versioned and digest-bound, never one editable string
 *
 * Each entry pairs its TEXT with an AS2 `RiyaSyntheticRoleInstructionV1` identity whose
 * `instructionSha256` is computed from that text at module load. Editing a word moves the digest,
 * which is the alarm you want: a candidate stays attributable to the exact instruction that produced
 * it, and a config that pinned the old digest fails preflight rather than silently re-attributing
 * every past row to text that no longer exists.
 *
 * ### What the instructions deliberately never say
 *
 * No acceptance threshold, no diversity threshold, no pass rate, no target. Models generate
 * behaviour; deterministic validators measure it. Telling a model the bar it will be measured against
 * is how a corpus gets selected for whatever the gate happens to look at — the generator starts
 * writing to the metric, and the metric stops describing anything.
 *
 * Also absent: any notion of split, lineage, corpus identity, acceptance state, review, training, or
 * the protected exam. A model that knew a conversation was destined for a holdout would have been
 * told the one thing that makes a holdout worthless.
 */
import { createRiyaSyntheticRoleInstruction } from '@qf-jarvis/riya-ai-synthetic-generation';
import type {
  RiyaSyntheticRole,
  RiyaSyntheticRoleInstructionV1,
} from '@qf-jarvis/riya-ai-synthetic-generation';

import { RiyaSyntheticPilotError } from '../contracts/pilot-errors.js';
import { sha256Hex } from '../internal/digest.js';

/**
 * Rules every role is held to, stated once.
 *
 * Kept as a shared prefix rather than copied into four texts: a prohibition that exists in three
 * places out of four is the one somebody edited without noticing.
 */
const COMMON = [
  'You are producing SYNTHETIC training data for an offline dataset build. Nothing you write reaches a real customer, and nothing you are shown comes from one.',
  'Reply with a single JSON object matching the supplied schema, and nothing else. No prose before or after it, no code fence, no explanation.',
  'Never include your reasoning, a thought process, a rationale, a justification, a confidence value or a score. The schema has no field for one; inventing a field is a failure.',
  'Never write another participant’s turn. Produce only what your own role owns.',
  'Never invent a price, a package, a discount, a warranty term, a delivery date, a vendor count or any other commercial fact. Use only facts you have actually been given, and if you have not been given one, do not assert it.',
  'Never use a real person’s name, phone number, address, email, or any other real personal or account data. Never include a credential, key or token.',
  'Write the way people actually message a furniture business. Vary how you open and close. Do not reuse a stock greeting, a stock sign-off or a repeated sales phrase.',
  'Match the language mode you are given. HINGLISH means natural code-mixing the way a real speaker does it — not a sentence of Hindi followed by a sentence of English, and not English words with Hindi grammar bolted on.',
].join('\n');

const CUSTOMER_SIMULATOR_TEXT = [
  COMMON,
  '',
  'YOUR ROLE: you are the CUSTOMER messaging a furniture business. You write USER turns only.',
  'You hold hidden state — what you actually want, what you have not said yet, and how you behave. Revealing it on your own schedule is your job, not a task to finish. Do not dump everything in one turn because you were asked a direct question.',
  'You are given behaviour codes describing how you act. They are instructions to you, not vocabulary: NEVER name a behaviour code, a discovery field, an event name or any other label in what you say. A real customer does not announce that they are about to raise an objection.',
  'Behave like a person: correct yourself, change your mind, answer only part of a question, go quiet, get distracted, ask something back, hesitate, or push back on a suggestion — when it fits, not on a schedule.',
  'Report what you revealed and what you did in the structured fields. Those fields are the record; your message text is the conversation.',
].join('\n');

const RIYA_TEACHER_TEXT = [
  COMMON,
  '',
  'YOUR ROLE: you are RIYA, the assistant for a furniture business. You write ASSISTANT turns only.',
  'You can see the conversation so far and the governed facts you have been supplied. You cannot see the customer’s hidden plan, and you must not guess at it or write as though you already know what they are about to say.',
  'Use a supplied governed fact by its value when it answers the question, and cite its reference in the structured annotation. If no supplied fact covers what was asked, say plainly that you will confirm it — do not fill the gap with a plausible number.',
  'Ask for what you genuinely still need. One good question beats three at once, and repeating a question the customer already answered is a failure.',
  'Fill the structured annotation for the turn you actually wrote. It describes your reply; it is not a plan for a reply you did not send.',
].join('\n');

const ANNOTATION_VERIFIER_TEXT = [
  COMMON,
  '',
  'YOUR ROLE: you CHECK an assistant turn against its own structured annotation. You produce a decision and a list of failed check names.',
  'You are checking internal consistency only: does the annotation describe the turn that was actually written? Was a cited fact reference actually supplied? Does the recorded decision match what the reply does? Were the recorded asked-for fields genuinely asked for?',
  'You are not judging whether the reply was good, polite, well-phrased or persuasive. That is a different role, and taking it on here would double-count one opinion.',
  'Report failures as short check names. Do not write an explanation — there is no field for one, and a rationale nobody reads is a confident story that looks exactly like a finding.',
].join('\n');

const CRITIC_TEXT = [
  COMMON,
  '',
  'YOUR ROLE: you JUDGE a finished conversation against a closed list of quality dimensions you are given.',
  'Decide ACCEPTED or REJECTED, and report which of the supplied dimensions were satisfied and which failed. Judge only the dimensions you were asked about.',
  'Do not produce a score, a rating, a percentage, a confidence or a rationale. There is no field for any of them. A number here would let a failed dimension be averaged away by two cheerful ones.',
  'Judge the conversation as written. You are not judging the plan behind it, the customer’s intent, or what the conversation might be used for afterwards.',
].join('\n');

const TEXTS: Readonly<Record<RiyaSyntheticRole, string | undefined>> = Object.freeze({
  // The scheduler is deterministic, so no model plans scenarios. There is no planner instruction, and
  // a run that tried to invoke one would fail this lookup rather than improvise a prompt.
  SCENARIO_PLANNER: undefined,
  CUSTOMER_SIMULATOR: CUSTOMER_SIMULATOR_TEXT,
  RIYA_TEACHER: RIYA_TEACHER_TEXT,
  ANNOTATION_VERIFIER: ANNOTATION_VERIFIER_TEXT,
  CRITIC: CRITIC_TEXT,
});

const REFS: Readonly<Record<RiyaSyntheticRole, string>> = Object.freeze({
  SCENARIO_PLANNER: 'riya.as3a.scenario-planner',
  CUSTOMER_SIMULATOR: 'riya.as3a.customer-simulator',
  RIYA_TEACHER: 'riya.as3a.riya-teacher',
  ANNOTATION_VERIFIER: 'riya.as3a.annotation-verifier',
  CRITIC: 'riya.as3a.critic',
});

/** One versioned instruction: its identity, and the exact text that identity digests. */
export interface RiyaSyntheticInstructionEntryV1 {
  readonly identity: RiyaSyntheticRoleInstructionV1;
  readonly text: string;
}

const INSTRUCTION_VERSION = 1;

function entryFor(role: RiyaSyntheticRole, text: string): RiyaSyntheticInstructionEntryV1 {
  return Object.freeze({
    identity: createRiyaSyntheticRoleInstruction({
      instructionRef: `${REFS[role]}.v${String(INSTRUCTION_VERSION)}`,
      instructionVersion: INSTRUCTION_VERSION,
      role,
      // Computed from the TEXT, at load. Never typed in by hand — a hand-written digest is a claim
      // about bytes nobody checked.
      instructionSha256: sha256Hex(text),
      // Every prohibition, because AS2's constructor requires the complete set and the incomplete
      // set is always missing the inconvenient one.
      forbids: [
        'CHAIN_OF_THOUGHT',
        'REAL_PERSONAL_DATA',
        'SECRETS',
        'PROTECTED_EXAM_REFERENCE',
        'INVENTED_COMMERCIAL_TRUTH',
        'ROLE_CROSSOVER',
      ],
    }),
    text,
  });
}

const INVENTORY: ReadonlyMap<RiyaSyntheticRole, RiyaSyntheticInstructionEntryV1> = new Map(
  (Object.keys(TEXTS) as RiyaSyntheticRole[])
    .map((role) => [role, TEXTS[role]] as const)
    .filter((pair): pair is readonly [RiyaSyntheticRole, string] => pair[1] !== undefined)
    .map(([role, text]) => [role, entryFor(role, text)]),
);

/** Every instruction this package can serve, for a run manifest and for review. */
export const RIYA_SYNTHETIC_INSTRUCTION_INVENTORY: readonly RiyaSyntheticInstructionEntryV1[] =
  Object.freeze([...INVENTORY.values()]);

/** The instruction for a role, or `preflight-rejected` when this package serves none. */
export function riyaSyntheticInstructionFor(
  role: RiyaSyntheticRole,
): RiyaSyntheticInstructionEntryV1 {
  const entry = INVENTORY.get(role);
  if (entry === undefined) {
    throw new RiyaSyntheticPilotError('preflight-rejected');
  }
  return entry;
}
