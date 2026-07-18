/**
 * `scanForDuplicateObjectKeys` — a small, deterministic, INTERNAL JSON scanner that answers exactly
 * one question about an authenticated raw body: **does any JSON object contain the same member name
 * twice, at any nesting depth?** (Stage 3.3.5, ADR-0033.)
 *
 * ### Why this exists
 *
 * `JSON.parse` resolves a duplicate object member *last-wins*, silently: `{"a":1,"a":2}` becomes
 * `{ a: 2 }`, and `{"a":1,"a":2}` — two escapes of the same Unicode name — becomes `{ a: 2 }`
 * too. For an authenticated event that is a **security-relevant ambiguity**: a signer and a verifier
 * (or two readers) could disagree about which value is "the" value. QF Jarvis therefore **rejects**
 * any object with a duplicate member name, decided **by decoded name equality**, before ordinary
 * `JSON.parse`-based preparation can collapse it. Signature verification still runs first
 * (`create-event-ingestor.ts`); this scan runs only on an already-authenticated body.
 *
 * ### Why a hand-written scanner, not a regex and not recursion
 *
 * - **Not a regex.** Duplicate detection needs real object *scope* — the same name in two different
 *   objects (`{"left":{"a":1},"right":{"a":2}}`) is valid, and a name inside a string value
 *   (`{"a":"b:,{}c"}`) is not a key. A regex cannot track scope or string context correctly.
 * - **Not recursion.** The raw body is bounded at 256 KiB, so a maximally nested input
 *   (`[[[[…]]]]`) could be ~131 072 levels deep — enough to overflow the JavaScript call stack.
 *   This scanner is fully **iterative**, with an explicit heap stack, so depth costs heap, not
 *   stack, and hostile nesting cannot crash the process.
 *
 * ### Correctness contract (what callers rely on)
 *
 * The scanner reports one of three results:
 *
 * - `'duplicate-object-key'` — it found, in valid key position, a member name already seen in the
 *   *same* object scope. This is a genuine duplicate that `JSON.parse` would collapse.
 * - `'ok'` — it parsed a complete, well-formed JSON value with no duplicate object key.
 * - `'malformed'` — the input is not well-formed JSON up to the point a decision could be made.
 *
 * A caller treats `'malformed'` as **"defer to `JSON.parse`"**: the scanner is authoritative only
 * for *duplicates*, and `JSON.parse` remains the single authority for whether a non-duplicate body
 * is valid. So the scanner must never report `'duplicate-object-key'` for a body that has no real
 * duplicate (a false positive would reject a valid event) and must never miss a real duplicate in
 * otherwise-valid JSON. A false `'malformed'` is harmless — the caller then parses normally.
 *
 * String names are compared by their **decoded** value, so `"a"`, `"a"`, and `"a"`
 * escaped differently all collide, and surrogate-pair escapes decode to the same UTF-16 sequence as
 * the literal character. The scanner reads no clock, environment, filesystem, or network, logs
 * nothing, allocates only bounded working state, and returns **no** decoded name or offset — the
 * result is one of three fixed tokens and nothing sender-controlled escapes.
 *
 * Not exported from the package barrel.
 */

/** The three possible outcomes of a duplicate-object-key scan. */
export type DuplicateObjectKeyScanResult = 'ok' | 'duplicate-object-key' | 'malformed';

/** Container frames on the explicit (heap) stack. Objects track the names seen in their own scope. */
type Frame = { readonly kind: 'object'; readonly keys: Set<string> } | { readonly kind: 'array' };

/**
 * What the parser expects to read next. This is a flat state machine over an explicit container
 * stack — no recursion — so arbitrarily deep nesting costs heap, never call stack.
 */
type State =
  | 'value' // the start of a value (top level, after ':' , or after ',' in an array)
  | 'array-first' // just after '[' : a value or ']'
  | 'object-first-key' // just after '{' : a key string or '}'
  | 'object-key' // after ',' in an object: a key string (no trailing '}')
  | 'object-colon' // after a key: ':'
  | 'object-comma' // after a member value: ',' or '}'
  | 'array-comma' // after an element: ',' or ']'
  | 'end'; // the sole top-level value is complete: only whitespace then EOF

const CHAR_SPACE = 0x20;
const CHAR_TAB = 0x09;
const CHAR_LF = 0x0a;
const CHAR_CR = 0x0d;
const CHAR_QUOTE = 0x22;
const CHAR_BACKSLASH = 0x5c;

/** The numeric value of a hex-digit char code, or -1 if it is not a hex digit. */
function hexValue(code: number): number {
  if (code >= 0x30 && code <= 0x39) {
    return code - 0x30; // 0-9
  }
  if (code >= 0x41 && code <= 0x46) {
    return code - 0x41 + 10; // A-F
  }
  if (code >= 0x61 && code <= 0x66) {
    return code - 0x61 + 10; // a-f
  }
  return -1;
}

/**
 * Scan `text` for a duplicate object member name at any depth. See the module doc for the exact
 * contract. Pure and iterative; O(number of characters) time and O(nesting depth) heap.
 */
export function scanForDuplicateObjectKeys(text: string): DuplicateObjectKeyScanResult {
  const length = text.length;
  let index = 0;
  const stack: Frame[] = [];
  let state: State = 'value';

  const skipWhitespace = (): void => {
    while (index < length) {
      const code = text.charCodeAt(index);
      if (code === CHAR_SPACE || code === CHAR_TAB || code === CHAR_LF || code === CHAR_CR) {
        index += 1;
      } else {
        break;
      }
    }
  };

  /**
   * Read a JSON string beginning at `text[index] === '"'` and return its DECODED value, or `null`
   * on any malformation (unterminated, bad escape, unescaped control character, truncated `\u`).
   * Comparison of decoded values is what makes escaped-equivalent names collide.
   */
  const readString = (): string | null => {
    index += 1; // consume the opening quote
    let out = '';
    while (index < length) {
      const code = text.charCodeAt(index);
      if (code === CHAR_QUOTE) {
        index += 1; // consume the closing quote
        return out;
      }
      if (code === CHAR_BACKSLASH) {
        index += 1;
        if (index >= length) {
          return null;
        }
        const esc = text[index];
        index += 1;
        switch (esc) {
          case '"':
            out += '"';
            break;
          case '\\':
            out += '\\';
            break;
          case '/':
            out += '/';
            break;
          case 'b':
            out += '\b';
            break;
          case 'f':
            out += '\f';
            break;
          case 'n':
            out += '\n';
            break;
          case 'r':
            out += '\r';
            break;
          case 't':
            out += '\t';
            break;
          case 'u': {
            if (index + 4 > length) {
              return null;
            }
            let unit = 0;
            for (let k = 0; k < 4; k += 1) {
              const nibble = hexValue(text.charCodeAt(index + k));
              if (nibble < 0) {
                return null;
              }
              unit = unit * 16 + nibble;
            }
            index += 4;
            // Append as a single UTF-16 code unit. A surrogate pair arrives as two consecutive
            // \u escapes, producing the same two code units as the literal character — so an
            // escaped name and its literal form are equal after decoding.
            out += String.fromCharCode(unit);
            break;
          }
          default:
            return null; // an invalid escape
        }
      } else if (code < CHAR_SPACE) {
        return null; // a raw control character is not allowed inside a JSON string
      } else {
        out += text.charAt(index);
        index += 1;
      }
    }
    return null; // unterminated
  };

  /** Consume a scalar literal (true/false/null/number). Returns false if none starts here. */
  const readScalar = (): boolean => {
    if (text.startsWith('true', index)) {
      index += 4;
      return true;
    }
    if (text.startsWith('false', index)) {
      index += 5;
      return true;
    }
    if (text.startsWith('null', index)) {
      index += 4;
      return true;
    }
    const first = text.charCodeAt(index);
    const isDigit = first >= 0x30 && first <= 0x39;
    const isMinus = first === 0x2d; // '-'
    if (!isDigit && !isMinus) {
      return false;
    }
    // Consume a maximal run of number characters. Precise number validity is JSON.parse's job:
    // a malformed number here only yields 'malformed' (deferred), never a false duplicate.
    let consumed = 0;
    while (index < length) {
      const code = text.charCodeAt(index);
      const numberish =
        (code >= 0x30 && code <= 0x39) || // 0-9
        code === 0x2d || // -
        code === 0x2b || // +
        code === 0x2e || // .
        code === 0x65 || // e
        code === 0x45; // E
      if (!numberish) {
        break;
      }
      index += 1;
      consumed += 1;
    }
    return consumed > 0;
  };

  /** After completing any value, the next expectation is dictated by the enclosing container. */
  const afterValue = (): void => {
    const top = stack[stack.length - 1];
    if (top === undefined) {
      state = 'end';
    } else if (top.kind === 'object') {
      state = 'object-comma';
    } else {
      state = 'array-comma';
    }
  };

  /**
   * A value is expected and the next non-whitespace char is `firstChar`. Begin it. Containers push
   * a frame and set the appropriate first-member state; scalars/strings complete immediately.
   * Returns 'ok' to continue, or 'malformed' if no value starts here.
   */
  const beginValue = (firstChar: string): 'ok' | 'malformed' => {
    if (firstChar === '{') {
      index += 1;
      stack.push({ kind: 'object', keys: new Set<string>() });
      state = 'object-first-key';
      return 'ok';
    }
    if (firstChar === '[') {
      index += 1;
      stack.push({ kind: 'array' });
      state = 'array-first';
      return 'ok';
    }
    if (firstChar === '"') {
      if (readString() === null) {
        return 'malformed';
      }
      afterValue();
      return 'ok';
    }
    if (!readScalar()) {
      return 'malformed';
    }
    afterValue();
    return 'ok';
  };

  /** Read an object member name in key position; detect a duplicate within the current object. */
  const readObjectKey = (currentFrame: Frame): DuplicateObjectKeyScanResult => {
    const name = readString();
    if (name === null) {
      return 'malformed';
    }
    // `currentFrame` is the enclosing object (guaranteed by the caller's state).
    if (currentFrame.kind !== 'object') {
      return 'malformed';
    }
    if (currentFrame.keys.has(name)) {
      return 'duplicate-object-key';
    }
    currentFrame.keys.add(name);
    state = 'object-colon';
    return 'ok';
  };

  for (;;) {
    skipWhitespace();

    if (index >= length) {
      // End of input: valid only if the sole top-level value completed and no container is open.
      // (`state` is closure-mutated; the cast restores the full union TypeScript cannot track.)
      return (state as State) === 'end' && stack.length === 0 ? 'ok' : 'malformed';
    }

    const char = text.charAt(index);

    // `state` is mutated by the arrow-function helpers above; TypeScript's control-flow analysis
    // cannot see those assignments, so it narrows `state` to only the values assigned inline. The
    // cast restores the full `State` union the closures can actually produce.
    switch (state as State) {
      case 'value': {
        if (beginValue(char) === 'malformed') {
          return 'malformed';
        }
        break;
      }

      case 'array-first': {
        if (char === ']') {
          index += 1;
          stack.pop();
          afterValue();
          break;
        }
        if (beginValue(char) === 'malformed') {
          return 'malformed';
        }
        break;
      }

      case 'object-first-key': {
        if (char === '}') {
          index += 1;
          stack.pop();
          afterValue();
          break;
        }
        if (char !== '"') {
          return 'malformed';
        }
        const top = stack[stack.length - 1];
        if (top === undefined) {
          return 'malformed';
        }
        const result = readObjectKey(top);
        if (result !== 'ok') {
          return result;
        }
        break;
      }

      case 'object-key': {
        if (char !== '"') {
          return 'malformed'; // a trailing comma or a non-string key
        }
        const top = stack[stack.length - 1];
        if (top === undefined) {
          return 'malformed';
        }
        const result = readObjectKey(top);
        if (result !== 'ok') {
          return result;
        }
        break;
      }

      case 'object-colon': {
        if (char !== ':') {
          return 'malformed';
        }
        index += 1;
        state = 'value';
        break;
      }

      case 'object-comma': {
        if (char === ',') {
          index += 1;
          state = 'object-key';
          break;
        }
        if (char === '}') {
          index += 1;
          stack.pop();
          afterValue();
          break;
        }
        return 'malformed';
      }

      case 'array-comma': {
        if (char === ',') {
          index += 1;
          state = 'value';
          break;
        }
        if (char === ']') {
          index += 1;
          stack.pop();
          afterValue();
          break;
        }
        return 'malformed';
      }

      case 'end': {
        // A value has completed at the top level, but more non-whitespace follows.
        return 'malformed';
      }

      default: {
        return 'malformed';
      }
    }
  }
}
