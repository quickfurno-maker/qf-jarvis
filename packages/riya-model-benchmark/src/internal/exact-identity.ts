/**
 * The one place this package reaches for the exact-identity rule (RMB-A).
 *
 * ### Why a re-export rather than three imports
 *
 * Subject, workload and environment all need it, and having each reach into
 * `@qf-jarvis/model-evaluation` separately would make the import boundary look wider than it is —
 * the containment spec proves this package takes IDENTITY ONLY from the evaluation package, and one
 * import site is easier to keep honest than three.
 *
 * It is a re-export, not a wrapper. There is no second implementation and no local variation of the
 * rule: the day the owner tightens or relaxes what "exact" means, it changes here by changing there.
 *
 * ### What the rule is for
 *
 * Durable benchmark evidence is quoted months later against runs nobody remembers. A moving alias
 * anywhere in it — `measurementPolicyRef: 'latest'`, `runtimeEngineVersion: 'latest'` — makes the
 * artifact describe something that has since changed, which is the same defect as a `latest` release
 * and just as invisible in the number.
 */
export { isExactGovernedIdentity } from '@qf-jarvis/model-evaluation';
