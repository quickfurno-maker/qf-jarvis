/**
 * The only way this operator is allowed to speak (MVP-P2A.2).
 *
 * ### Why a module rather than a discipline
 *
 * This process holds, at various moments, a Groq credential, seventy-two synthetic client turns, a
 * malicious grounded record containing a sentinel, and every reply a candidate produced. Exactly one
 * of those is meant to leave the machine, and it leaves through the blinded review bundle — not
 * through a terminal. A `console.log` added later "just to debug" is how that stops being true, so
 * printing goes through a function whose signature cannot carry content: keys, closed vocabulary
 * values and numbers.
 *
 * The review bundle legitimately contains candidate replies; that is its whole purpose and it is
 * written to an operator-supplied path outside the repository. The console is a different surface
 * with a different audience, and it gets none of that.
 */

/** A value safe to print: a closed-vocabulary token, a count, or a path the operator supplied. */
export type SafeValue = string | number | boolean;

export interface SafeConsole {
  line(fields: Readonly<Record<string, SafeValue>>): void;
  /** A single content-free notice. Used for the one thing the operator must say in prose. */
  notice(message: string): void;
}

/**
 * `key=value` pairs on one line, in insertion order.
 *
 * Deliberately not JSON: a JSON printer invites somebody to hand it an object, and an object is how
 * a reply body ends up on a terminal. Every value here had to be named and passed one at a time.
 */
export function createSafeConsole(write: (line: string) => void): SafeConsole {
  return Object.freeze({
    line(fields: Readonly<Record<string, SafeValue>>): void {
      write(
        Object.entries(fields)
          .map(([key, value]) => `${key}=${String(value)}`)
          .join(' '),
      );
    },
    notice(message: string): void {
      write(message);
    },
  });
}

/** Writes to stdout. The one place this package touches a real output stream. */
export function createStdoutSafeConsole(): SafeConsole {
  return createSafeConsole((line) => {
    process.stdout.write(`${line}\n`);
  });
}
