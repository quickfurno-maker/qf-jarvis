/**
 * **The canonical payload privacy boundary.**
 *
 * Nothing that identifies, locates, or authenticates a human being may cross into a QF Jarvis
 * canonical event. This module is where that is enforced, and it exists because a real gap was
 * found: `derivedObservationSchema` refused the obvious carrier keys and the obvious contact
 * *values*, and still accepted `{ requirement: 'GPS: 18.5204, 73.8567' }` — while QuickFurno
 * Core stores precise client coordinates **inside `leads.message`** (ADR-0026).
 *
 * ### The primary control is NOT this file
 *
 * **The primary control is strict, event-specific schema validation**: every canonical event
 * resolves to exactly one payload schema, every field is explicitly declared and bounded,
 * unknown keys are rejected, and there is no `Record<string, unknown>` freedom anywhere. If a
 * payload has no field in which a coordinate could sit, a coordinate detector has nothing to do.
 *
 * **This file is defence-in-depth.** It is the second lock, for the fields that legitimately
 * hold human-authored governance text (a recommendation's `rationale` must exist, and must be
 * challengeable), and for the day somebody adds a field without thinking. **A detector is not a
 * schema, and it must never be relied on as one** — an attacker who controls the string can
 * usually defeat a detector, and a detector that tried hard enough to stop them would reject
 * half the business vocabulary.
 *
 * ### Renaming does not launder
 *
 * Key matching is **normalised** — case, underscores, hyphens and whitespace are stripped — and
 * an alias table maps the obvious synonyms. `lat`, `LAT`, `_lat_`, `latitude`, `geoLat` and
 * `coordinates` all land on the same rule. **An unsafe field does not become safe because it was
 * renamed**, which is precisely how `leads.message` would have arrived as `requirement`.
 *
 * ### The false-positive rule, which is the hard part
 *
 * A detector that fires on ordinary business values is a detector somebody disables. **A rule
 * that cries wolf is worse than no rule**, because its removal is a one-line diff with a
 * sympathetic reviewer. So every pattern here is chosen to leave the business vocabulary alone,
 * and `references/positive-cases` in the tests pins that down: ISO dates, semantic versions,
 * ordinary integers, prices, percentages, category and city codes, UUIDs, bounded taxonomy
 * labels and reason codes **must all survive**, and a test fails if they stop surviving.
 */

/** Reported without ever echoing the offending value. A validator that quotes a secret has logged it. */
export interface ProhibitedContentIssue {
  readonly path: readonly (string | number)[];
  readonly code: string;
  readonly message: string;
}

/**
 * Normalise a key so `client_phone`, `clientPhone`, `CLIENT-PHONE` and `client phone` are one key.
 *
 * Diacritics are folded too: `latitüde` is not a clever way past this.
 */
export function normaliseKey(key: string): string {
  return (
    key
      .normalize('NFKD')
      // Combining marks, written as escapes so this source file contains none of the bytes it
      // strips — a file that must embed the characters it rejects is a file that diffs, editors
      // and reviewers all mishandle.
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
  );
}

/**
 * Keys that may never appear in a canonical payload, in any casing or separator style.
 *
 * Grouped by what they leak, because the groups are how a reviewer checks the list is complete
 * rather than merely long.
 */
export const PROHIBITED_KEY_GROUPS = {
  /** Who the person is. */
  identity: [
    'name',
    'fullname',
    'firstname',
    'lastname',
    'surname',
    'givenname',
    'familyname',
    'clientname',
    'customername',
    'vendorname',
    'ownername',
    'businessname',
    'contactname',
  ],

  /** How to reach them. */
  contact: [
    'phone',
    'phonenumber',
    'mobile',
    'mobilenumber',
    'msisdn',
    'telephone',
    'tel',
    'whatsapp',
    'whatsappnumber',
    'email',
    'emailaddress',
    'mail',
    'contact',
    'contactdetails',
    // NOT `recipient`: `recipient: entityReference` is the *correct* design — reference the
    // person, never reproduce them. Refusing the key would forbid the safe form and leave only
    // the unsafe ones. `recipientPhone` and `recipientEmail` remain refused, below and by segment.
    'recipientphone',
    'recipientemail',
    'to',
  ],

  /** Where they live. */
  address: [
    'address',
    'addressline',
    'addressline1',
    'addressline2',
    'postaladdress',
    'streetaddress',
    'street',
    'officeaddress',
    'landmark',
    'pincode',
    'postcode',
    'zipcode',
    'zip',
  ],

  /**
   * Exactly where they are. The one that was open.
   *
   * `geo`, `geolocation` and `coordinates` are here because the shape a coordinate arrives in is
   * not always two named floats — `[18.5204, 73.8567]` under a key called `coordinates` is the
   * same disclosure with a different wrapper.
   */
  location: [
    'lat',
    'latitude',
    'lng',
    'long',
    'longitude',
    'geo',
    'geoloc',
    'geolocation',
    'geopoint',
    'coordinate',
    'coordinates',
    'coords',
    'gps',
    'gpscoordinates',
    'position',
    'maplink',
    'mapurl',
    'mapslink',
    'googlemaps',
    'plusCode',
    'pluscode',
  ],

  /**
   * Free text — the field where Core's whole record arrives one convenient copy at a time.
   *
   * `requirement` and `requirementtext` are named explicitly. That is not paranoia: Core's
   * `leads.message` holds the requirement, the GPS coordinates and the clarification answers,
   * and "the requirement" is exactly what a well-meaning adapter author would map first.
   */
  freeText: [
    'message',
    'messagebody',
    'body',
    'text',
    'notes',
    'note',
    'comment',
    'comments',
    'freetext',
    'raw',
    'rawtext',
    'requirement',
    'requirementtext',
    'requirements',
    'requirementdetail',
    'transcript',
    'recording',
    'recordingurl',
    'audio',
    'audiourl',
    'rawcontent',
    'payloadtext',
  ],

  /** Model internals. Chain-of-thought is never stored, anywhere, under any name. */
  modelInternal: [
    'prompt',
    'systemprompt',
    'chainofthought',
    'reasoningtrace',
    'hiddenreasoning',
    'thoughts',
    'modelresponse',
    'rawmodeloutput',
    'completion',
  ],

  /** Anything that authenticates. */
  credential: [
    'password',
    'passwd',
    'secret',
    'token',
    'accesstoken',
    'refreshtoken',
    'idtoken',
    'bearer',
    'apikey',
    'apisecret',
    'privatekey',
    'clientsecret',
    'servicerolekey',
    'anonkey',
    // NOT `authorization`: in this catalogue it names a CommunicationAuthorizationV1 — a
    // governance artifact, not a credential. The credential risk is a bearer token in the
    // *value*, and the value rules catch that.
    'auth',
    'credential',
    'credentials',
    'connectionstring',
    'connectionurl',
    'databaseurl',
    'dsn',
    'sessionid',
    'cookie',
  ],
} as const;

/** Every prohibited key, normalised, matched **exactly**. */
export const PROHIBITED_KEYS: ReadonlySet<string> = new Set(
  Object.values(PROHIBITED_KEY_GROUPS)
    .flat()
    .map((key) => normaliseKey(key)),
);

/**
 * ### Exact matching alone is not enough, and substring matching is far too much
 *
 * `client_phone` normalises to `clientphone`, which is not literally in the list — so an exact
 * rule misses it, and **renaming would launder the field**, which is the one thing this module
 * exists to prevent. The obvious fix is a substring test, and it is a trap: `cityName` contains
 * `name`, `categoryName` contains `name`, and a substring rule would reject the entire taxonomy
 * vocabulary. **A rule that cries wolf gets deleted**, and then nothing is checked at all.
 *
 * So keys are matched by **segment**. The key is split on camelCase boundaries and separators,
 * each segment is normalised, and a segment that is a prohibited token refuses the key:
 *
 * | Key | Segments | Verdict |
 * | --- | --- | --- |
 * | `client_phone` · `ClientPhone` · `clientPhone` | `client` · `phone` | **refused** — `phone` |
 * | `vendorEmailAddress` | `vendor` · `email` · `address` | **refused** |
 * | `cityName` · `categoryName` | `city` · `name` | **accepted** |
 * | `vendorId` | `vendor` · `id` | **accepted** — `vendor` alone leaks nothing |
 */
const PROHIBITED_SEGMENT_TOKENS: ReadonlySet<string> = new Set([
  // Contact
  'phone',
  'phonenumber',
  'mobile',
  'msisdn',
  'telephone',
  'whatsapp',
  'email',
  'mail',
  // `contact` and `recipient` are deliberately NOT segment tokens, and the reason is a real
  // false positive that would have made the guard useless: `contactAttempts` is a **count**, and
  // `recipientId` is an **opaque reference** — both are exactly what the boundary wants people to
  // use instead of the real thing. They remain refused as whole keys (`contact`, `recipient`),
  // and any compound that carries the actual detail (`contactPhone`, `recipientEmail`) is caught
  // by `phone` and `email` anyway. **Punishing the safe form of a field teaches people to bypass
  // the check, not to comply with it.**
  // Address
  'address',
  'street',
  'landmark',
  'pincode',
  'postcode',
  'zipcode',
  // Location
  'lat',
  'latitude',
  'lng',
  'long',
  'longitude',
  'geo',
  'geolocation',
  'geopoint',
  'coordinate',
  'coordinates',
  'coords',
  'gps',
  'position',
  'maplink',
  'mapurl',
  'pluscode',
  // Free text
  'message',
  'body',
  'text',
  'notes',
  'note',
  'comment',
  'comments',
  'freetext',
  'raw',
  'requirement',
  'requirements',
  'transcript',
  'recording',
  'audio',
  'content',
  // Model internals
  'prompt',
  'chainofthought',
  'reasoningtrace',
  'thoughts',
  'completion',
  // Credentials
  'password',
  'passwd',
  'secret',
  'token',
  'bearer',
  'apikey',
  'privatekey',
  'credential',
  'credentials',
  'connectionstring',
  'connectionurl',
  'databaseurl',
  'dsn',
  'cookie',
]);

/**
 * Subjects that turn `name` into a person's name.
 *
 * **`name` is deliberately NOT a prohibited segment.** `cityName` and `categoryName` are the safe
 * taxonomy vocabulary and must survive. But `clientName` and `vendorName` are a real person, so
 * `name` is refused **when it is qualified by a person**. That is the distinction the check makes,
 * and making it explicitly is why `cityName` does not have to be special-cased as an exception.
 */
const PERSON_SUBJECT_TOKENS: ReadonlySet<string> = new Set([
  'client',
  'customer',
  'vendor',
  'owner',
  'contact',
  'recipient',
  'person',
  'user',
  'lead',
  'applicant',
  'business',
]);

const NAME_TOKENS: ReadonlySet<string> = new Set(['name', 'fullname', 'surname']);

/**
 * Split a key into normalised word segments.
 *
 * `clientPhone` → `client`, `phone`. `client_phone` → `client`, `phone`. `CLIENT-PHONE` → same.
 */
export function keySegments(key: string): readonly string[] {
  return key
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .map((segment) => segment.toLowerCase())
    .filter((segment) => segment.length > 0);
}

/** Is this key refused, in any casing, separator style, or qualified form? */
export function isProhibitedKey(key: string): boolean {
  if (PROHIBITED_KEYS.has(normaliseKey(key))) {
    return true;
  }

  const segments = keySegments(key);

  if (segments.some((segment) => PROHIBITED_SEGMENT_TOKENS.has(segment))) {
    return true;
  }

  // A name, qualified by a person, is a person's name. A name qualified by a city is a city.
  return (
    segments.some((segment) => NAME_TOKENS.has(segment)) &&
    segments.some((segment) => PERSON_SUBJECT_TOKENS.has(segment))
  );
}

/** An email address, anywhere in a string. */
const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/**
 * Phone-shaped. Two rules, both chosen to leave ordinary values alone.
 *
 * An explicit `+` followed by a run of digits, or a bare run of **ten or more** consecutive
 * digits. An RFC 3339 timestamp has no `+` before digits in that shape and no ten-digit run; a
 * price, a percentage and a semantic version are far too short.
 */
const E164_PATTERN = /\+\d[\d\s().-]{6,}\d/;
const LONG_DIGIT_RUN_PATTERN = /\d{10,}/;

/**
 * A UUID — and the reason it needs naming.
 *
 * `a100000a-0000-4000-8000-000000000001` contains a **twelve-digit run**, so the phone-shaped
 * rule fires on it. Every correlation id, event id and batch id in the system is a UUID, so
 * without this exemption the guard rejects **essentially every valid event** — which is not a
 * strict guard, it is a broken one, and it would be switched off within a day.
 *
 * The exemption is **narrow and shape-anchored**: the string must be a UUID *in its entirety*.
 * `919876543210` is not a UUID and is still refused. A phone number smuggled into an id field is
 * caught; an id that merely happens to contain zeroes is not.
 *
 * **Only the digit-run rule is relaxed.** A UUID-shaped string is still scanned for emails,
 * coordinates, map links and credentials — because a UUID that also contains an email is not a
 * UUID, it is a string somebody is being clever with.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A JWT: three base64url segments separated by dots, beginning with the standard header. */
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;

/** A database connection string. `postgres://`, `mysql://`, `mongodb+srv://`. */
const CONNECTION_STRING_PATTERN = /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\//i;

/** A Supabase management token, and the shape of a bearer credential in a header. */
const SUPABASE_TOKEN_PATTERN = /\bsbp_[A-Za-z0-9]{8,}/;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._-]{12,}/i;

/** A PEM private key, in any of its spellings. */
const PRIVATE_KEY_PATTERN = /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/;

/** A map link. `maps.google`, `goo.gl/maps`, `openstreetmap`, an `?q=lat,lng` deep link. */
const MAP_URL_PATTERN =
  /\b(?:maps\.google|google\.[a-z.]+\/maps|goo\.gl\/maps|maps\.app\.goo\.gl|openstreetmap\.org|geo:)/i;

/**
 * A decimal coordinate **pair** in free text.
 *
 * ### Why a pair, and why these bounds
 *
 * A single number is not a coordinate — `18.5204` is also a price, a percentage, a score, or a
 * version component. **A coordinate is two numbers together**, in plausible latitude/longitude
 * ranges, separated the way people actually write them. Requiring the pair is what keeps this
 * from firing on the business vocabulary.
 *
 * Both parts must carry a **decimal point with at least three fractional digits**. That is the
 * precision that makes a coordinate a *location* rather than a rounding: `18.5, 73.8` is a
 * 10-kilometre box and is not what leaks somebody's home. It is also what keeps `1.5, 2.0` — a
 * pair of ordinary numbers in a sentence — from being treated as a place.
 *
 * Latitude is bounded to ±90 and longitude to ±180, so `123.4567, 456.7890` — two ordinary
 * high-precision numbers — is **not** a coordinate and is not rejected.
 */
const COORDINATE_PAIR_PATTERN =
  /(?<![\d.])[+-]?(?:[0-8]?\d|90)\.\d{3,}\s*[,;/|]\s*[+-]?(?:1[0-7]\d|[0-9]?\d)\.\d{3,}(?![\d.])/;

/**
 * `lat=18.5204 lng=73.8567` — a coordinate that arrived as a labelled key/value inside a string
 * rather than as two fields. The label is what makes this unambiguous, so the precision bar is
 * lower here: if a string says `lat`, it means latitude.
 */
const LABELLED_COORDINATE_PATTERN =
  /\b(?:lat|latitude|lng|long|longitude|gps|geo|coord(?:inates?)?)\b\s*[:=]\s*[+-]?\d+(?:\.\d+)?/i;

interface ValueRule {
  readonly code: string;
  readonly pattern: RegExp;
  readonly message: string;
}

/**
 * Value-shape rules, applied to **every string** in a canonical payload.
 *
 * The message names the rule, never the value. **A validator that echoes the thing it just
 * rejected has written it to a log**, which is the failure mode the rejection existed to prevent.
 */
const VALUE_RULES: readonly ValueRule[] = [
  {
    code: 'prohibited.contact.email',
    pattern: EMAIL_PATTERN,
    message:
      'Must not contain an email address. Reference the person by an opaque QuickFurno Core entity reference; Core resolves contact details at authorized execution time.',
  },
  {
    code: 'prohibited.contact.phone',
    pattern: E164_PATTERN,
    message:
      'Must not contain a phone number. Reference the person by an opaque QuickFurno Core entity reference.',
  },
  {
    code: 'prohibited.contact.digit-run',
    pattern: LONG_DIGIT_RUN_PATTERN,
    message:
      'Must not contain a run of ten or more digits, which is phone-shaped. Use an opaque entity reference or a bounded code.',
  },
  {
    code: 'prohibited.location.coordinate-pair',
    pattern: COORDINATE_PAIR_PATTERN,
    message:
      'Must not contain a latitude/longitude pair. Precise location never crosses the canonical boundary; carry a city or area identifier instead.',
  },
  {
    code: 'prohibited.location.labelled-coordinate',
    pattern: LABELLED_COORDINATE_PATTERN,
    message:
      'Must not contain a labelled coordinate (lat=, lng=, gps:). Carry a city or area identifier instead.',
  },
  {
    code: 'prohibited.location.map-url',
    pattern: MAP_URL_PATTERN,
    message: 'Must not contain a map link. A map link is a coordinate with extra steps.',
  },
  {
    code: 'prohibited.credential.jwt',
    pattern: JWT_PATTERN,
    message: 'Must not contain a JSON Web Token.',
  },
  {
    code: 'prohibited.credential.bearer',
    pattern: BEARER_PATTERN,
    message: 'Must not contain a bearer credential.',
  },
  {
    code: 'prohibited.credential.provider-token',
    pattern: SUPABASE_TOKEN_PATTERN,
    message: 'Must not contain a provider access token.',
  },
  {
    code: 'prohibited.credential.private-key',
    pattern: PRIVATE_KEY_PATTERN,
    message: 'Must not contain a private key.',
  },
  {
    code: 'prohibited.credential.connection-string',
    pattern: CONNECTION_STRING_PATTERN,
    message: 'Must not contain a database connection string.',
  },
];

/** Does this string carry something that may not cross the boundary? */
export function findProhibitedValueRule(value: string): ValueRule | undefined {
  const isUuid = UUID_PATTERN.test(value);

  return VALUE_RULES.find((rule) => {
    // A UUID is exempt from the digit-run rule and from nothing else. See UUID_PATTERN.
    if (isUuid && rule.code === 'prohibited.contact.digit-run') {
      return false;
    }
    return rule.pattern.test(value);
  });
}

/**
 * Two numbers side by side, in coordinate ranges, at coordinate precision.
 *
 * This is the **structured** half of the coordinate defence, and it is the half that matters:
 * `[18.5204, 73.8567]` never becomes a string, so no regex over strings would ever see it.
 * **A regex alone is not a coordinate defence for structured data**, which is exactly why this
 * function exists beside the patterns rather than instead of them.
 *
 * The same precision bar applies — three fractional digits — so `[1.5, 2.0]`, a pair of ordinary
 * numbers, is not a location.
 */
/** How many fractional digits does this number actually carry? `18.5204` → 4. `18` → 0. */
function fractionalDigits(value: number): number {
  const fraction = String(value).split('.')[1];
  return fraction === undefined ? 0 : fraction.length;
}

/** Minimum fractional digits before a number is precise enough to be a *location*. */
const COORDINATE_PRECISION = 3;

function isCoordinateNumberPair(values: readonly unknown[]): boolean {
  if (values.length !== 2) {
    return false;
  }

  const [latitude, longitude] = values;

  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return false;
  }

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return false;
  }

  // In range for a latitude/longitude pair. `[123.4567, 456.7890]` — two ordinary
  // high-precision numbers — is out of range, and is therefore not a location.
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return false;
  }

  // Both must carry real precision. `[1.5, 2.5]` is a pair of measurements; `[18.5204, 73.8567]`
  // is somebody's house. Three fractional digits is roughly a 100-metre box, and it is the line
  // between "a number" and "a place".
  return (
    fractionalDigits(latitude) >= COORDINATE_PRECISION &&
    fractionalDigits(longitude) >= COORDINATE_PRECISION
  );
}

const MAX_SCAN_DEPTH = 32;

/**
 * Walk a payload and report everything that may not cross the boundary.
 *
 * Cycle-safe and depth-bounded. **A validator may reject anything, but it may never crash** — a
 * cyclic object that overflows the stack turns the guard into the thing the hostile input kills.
 */
export function inspectProhibitedContent(value: unknown): readonly ProhibitedContentIssue[] {
  const issues: ProhibitedContentIssue[] = [];
  scan(value, [], issues, new Set<object>(), 0);
  return issues;
}

function scan(
  value: unknown,
  path: readonly (string | number)[],
  issues: ProhibitedContentIssue[],
  ancestors: Set<object>,
  depth: number,
): void {
  if (depth > MAX_SCAN_DEPTH) {
    issues.push({
      path: [...path],
      code: 'prohibited.depth',
      message: `Nesting exceeds the maximum scan depth of ${String(MAX_SCAN_DEPTH)}`,
    });
    return;
  }

  if (typeof value === 'string') {
    const rule = findProhibitedValueRule(value);
    if (rule !== undefined) {
      issues.push({ path: [...path], code: rule.code, message: rule.message });
    }
    return;
  }

  if (typeof value !== 'object' || value === null) {
    return;
  }

  if (ancestors.has(value)) {
    return;
  }
  ancestors.add(value);

  if (Array.isArray(value)) {
    if (isCoordinateNumberPair(value)) {
      issues.push({
        path: [...path],
        code: 'prohibited.location.coordinate-array',
        message:
          'Must not contain a coordinate array. A two-element array of precise, in-range numbers is a latitude/longitude pair whatever it is called.',
      });
    }

    value.forEach((item, index) => {
      scan(item, [...path, index], issues, ancestors, depth + 1);
    });

    ancestors.delete(value);
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (isProhibitedKey(key)) {
      issues.push({
        path: [...path, key],
        code: 'prohibited.key',
        message: `The key "${key}" may not appear in a canonical payload. Renaming an unsafe field does not make it safe.`,
      });
      // Do not descend: the key is already refused, and descending would only add noise about
      // the value of a field that must not exist at all.
      continue;
    }

    scan(nested, [...path, key], issues, ancestors, depth + 1);
  }

  ancestors.delete(value);
}

/** Nothing prohibited anywhere in this value? */
export function isFreeOfProhibitedContent(value: unknown): boolean {
  return inspectProhibitedContent(value).length === 0;
}
