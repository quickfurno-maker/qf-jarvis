/**
 * High-confidence volatile-claim hints on ASSISTANT text (RID-F1 owner correction on PR #112).
 *
 * ### What this closes
 *
 * The first firewall proved that every cited fact existed earlier. It did not prove that a turn which
 * ASSERTS a business fact cited anything at all — so this was representable, and passed:
 *
 * ```
 * assistant: "It starts around 6 lakh."
 * decision:  ANSWER_DIRECT
 * supportedFactRefs: []
 * ```
 *
 * A corpus containing that teaches the model that a price is something it may simply produce. Which
 * is exactly the failure the whole business-fact rule exists to prevent, arriving through the one
 * door the rule did not cover.
 *
 * ### Deliberately narrow
 *
 * Only shapes that are unambiguous in an interiors sales conversation, and each needs BOTH a
 * subject-matter signal and a first-person assertion cue. A scanner that fired on "your 7 lakh quote"
 * or "budgets in that range vary" would be turned off within a month, and a turned-off gate protects
 * nothing.
 *
 * `PACKAGE`, `PROCESS` and `OTHER_BUSINESS_FACT` are deliberately NOT detected. Their language is not
 * separable from ordinary conversation without semantics this package refuses to guess at, and
 * pretending otherwise would trade a real gate for a plausible-looking one. Those classes are still
 * enforced when a turn DOES cite them — the decision and authority rules cover that path.
 *
 * ### It never reads USER text
 *
 * A customer saying "I got a 7 lakh quote" or "our budget is 10 lakh" is stating their own position.
 * It is not a claim about the business, it needs no authority, and treating it as one would make a
 * competitor's number into something Riya must have been told.
 *
 * ### It never echoes what it matched
 *
 * A finding is a closed fact class. The text stays where it was.
 */
import type { RiyaDatasetFactClass } from '../contracts/vocabularies.js';

/** An amount a business would quote: a currency figure, or lakh/crore. */
const AMOUNT =
  /(?:₹|\brs\.?\b|\binr\b|\brupees?\b)\s*[\d,]+|\b[\d.,]+\s*(?:lakh|lakhs|crore|crores)\b/iu;

/** A first-person assertion about what it costs — not a question, not the customer's number. */
const PRICE_ASSERTION =
  /\b(?:we|our|it|that|this)\s+(?:would\s+)?(?:typically\s+)?(?:charge|charges|cost|costs|start|starts|begin|begins)\b|\bour\s+(?:price|pricing|cost|rate|rates)\b|\b(?:price|cost)\s+(?:is|would be|comes to)\b|\bstart(?:s|ing)?\s+(?:at|around|from)\b/iu;

const WARRANTY_TERM = /\b(?:warrant(?:y|ies)|guarantee[ds]?)\b/iu;
const WARRANTY_ASSERTION =
  /\b\d+\s*(?:year|yr|month)s?\b|\bwe\s+(?:offer|provide|give|cover|back)\b|\bcovered\s+(?:for|under)\b|\bcomes\s+with\b/iu;

const AVAILABILITY_ASSERTION =
  /\bwe\s+(?:offer|provide|serve|cover|operate|work)\b|\b(?:is|are)\s+available\s+(?:in|for|across)\b|\bwe\s+(?:do|don't|do not)\s+(?:take|handle)\b/iu;
const AVAILABILITY_SUBJECT = /\b(?:in|across|for)\b|\bservice\b|\bcity\b|\bcities\b|\barea\b/iu;

const POLICY_ASSERTION =
  /\b(?:refund|cancellation|cancelation)\s+policy\b|\bwe\s+(?:refund|do not refund|don't refund|allow\s+cancellation)\b|\bfully\s+refundable\b|\bnon[-\s]?refundable\b/iu;

const STATUS_ASSERTION =
  /\byour\s+(?:payment|order|project|booking|consultation|request)\s+(?:is|has been)\s+(?:paid|approved|active|registered|assigned|confirmed|scheduled)\b|\b(?:has been|is)\s+(?:approved|assigned|registered|confirmed)\s+(?:now|already)\b/iu;

/**
 * Which volatile fact classes this assistant text high-confidently asserts.
 *
 * Sorted and deduplicated. Empty for anything ambiguous, which is the common case and the intended
 * one: this gate exists to catch the obvious unsupported claim, not to adjudicate tone.
 */
export function detectVolatileClaimClasses(assistantText: string): readonly RiyaDatasetFactClass[] {
  const found = new Set<RiyaDatasetFactClass>();

  if (AMOUNT.test(assistantText) && PRICE_ASSERTION.test(assistantText)) {
    found.add('PRICE');
  }
  if (WARRANTY_TERM.test(assistantText) && WARRANTY_ASSERTION.test(assistantText)) {
    found.add('WARRANTY');
  }
  if (AVAILABILITY_ASSERTION.test(assistantText) && AVAILABILITY_SUBJECT.test(assistantText)) {
    found.add('SERVICE_AVAILABILITY');
  }
  if (POLICY_ASSERTION.test(assistantText)) {
    found.add('POLICY');
  }
  if (STATUS_ASSERTION.test(assistantText)) {
    found.add('CURRENT_STATUS');
  }

  return Object.freeze([...found].sort());
}
