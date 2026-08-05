/**
 * The headers every authentication response carries (JOS-01C, ADR-0087; JOS-01D correction).
 *
 * ### Why this is one constant rather than four literals
 *
 * The login and logout routes each build several `303` responses, and every one of them repeated
 * the same three headers. That duplication is how the Firefox defect became possible to reintroduce
 * in one place and not another: `Referrer-Policy` is not decoration here, it decides whether a
 * browser will send a usable `Origin` on the next form submission, and a value that differs between
 * two redirect paths produces an intermittent, browser-specific authentication failure.
 *
 * Declaring it once makes the policy consistent by construction instead of by review.
 *
 * ### `Referrer-Policy: same-origin`
 *
 * NOT `no-referrer`. Firefox derives a form submission's `Origin` header from the document's
 * referrer policy; under `no-referrer` it sends `Origin: null` even for a genuinely same-origin
 * POST, which `requireSameOriginMutation` correctly refuses. Chromium does not do this, so the
 * failure was invisible to scripted requests and to every automated check.
 *
 * The fix belongs here and not in the validator: accepting `Origin: null` would accept exactly the
 * value a sandboxed iframe and a privacy-stripped cross-origin form send, and `null` is
 * unattributable by definition. `same-origin` still sends NOTHING to any other origin, so no
 * operator URL leaks off-site.
 */
export const AUTH_RESPONSE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  // An authentication response is never cacheable and never shared.
  'Cache-Control': 'no-store, private',
  'Referrer-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
});
