# ADR-0129 — Control-plane read contract V2

- **Status:** Accepted (read contract only; no runtime activation, no live source, no mutation)
- **Owner phase:** QFJ-P12 — Aarohi Vendor Growth and Acquisition (the wire half of AVG-11)
- **Certified qf-jarvis baseline:** `7bb65d785d8d7b81d87df91ab913500737e1dd56` (PR #169 / AVG-10 merge)
- **Supersedes:** nothing. It **extends** the change-control rule of
  [ADR-0086](ADR-0086-jos-01b-read-only-control-plane-contract-and-snapshot-api.md), which remains
  the governing ADR for contract **V1** and for everything V1 says.
- **Related:**
  [ADR-0086](ADR-0086-jos-01b-read-only-control-plane-contract-and-snapshot-api.md) (V1, the parse
  boundary, the route),
  [ADR-0089](ADR-0089-jos-01e-progressive-backend-read-source-composition-boundary.md) (progressive
  read-source composition, which both versions share),
  [ADR-0128](ADR-0128-qfj-p12-avg11-aarohi-analytics-admin-dashboard-offline-domain.md) (AVG-11, the
  analytics domain whose wire additions live here)

---

## Context

ADR-0086 wrote the rule this ADR exists to obey, and wrote it in one sentence:

> `contractVersion` is `"1"`. A breaking change to the snapshot shape requires a new version and a
> superseding ADR, **not an edit in place** — a shipped Android client cannot be asked to re-parse.
> Adding an authority field, a credential field, a contact detail or an unbounded value is prohibited
> at every version.

AVG-11 (ADR-0128) needs two changes to the snapshot shape:

1. **The funnel stage becomes a discriminated union** over a closed Aarohi stage vocabulary, so that
   a stage carries the AUTHORITY entitled to state its number and an unavailable stage carries no
   number at all. A V1 stage — `{ id, label, value, caption }`, free identifier, no authority —
   satisfies no branch of it.
2. **A new section, `sections.aarohiAcquisitionReadiness`**, joins a `.strict()` sections object, so
   every producer that does not emit it stops being valid.

Each is breaking in one direction, and together they are breaking in both. The first refuses old
payloads; the second refuses old producers.

### The mistake this ADR corrects

The first implementation of AVG-11 made both changes **in place at V1** and argued that the change
merely _tightened_ the contract: the closed stage vocabulary only removes freedom, and the one
producer in this repository emits no funnel stages at all, so nothing in the repository broke.

That reasoning was wrong twice.

It was wrong about the rule, which is about the SHAPE and not about whether a repository-local
producer happens to violate it today. And it was wrong about the facts: two worker test fixtures
immediately stopped parsing, which is precisely the failure mode a shipped client would have had —
found by accident, because the fixtures happened to live in this repository. A client that had
already shipped would have had no such luck.

Tightening is a breaking change for whoever is already producing the old shape. The whole point of
writing a change-control rule down is that it binds on the day somebody has a good reason to skip it.

---

## Decision

### 1. V1 is frozen, and this ADR does not touch it

`packages/control-plane-read-contract/src/contract/snapshot.ts` is byte-identical to what it was at
the certified baseline. `CONTROL_PLANE_READ_CONTRACT_VERSION` is still `'1'`,
`parseControlPlaneSnapshotV1` still enforces exactly the V1 shape, and
`GET /api/control-plane/v1/snapshot` still serves exactly what it served before AVG-11.

A **golden** pre-AVG-11 payload is kept as a frozen literal typed `unknown`
(`tests/golden-v1-snapshot.ts`) and must go on parsing. Typed `unknown` on purpose: every other
fixture in the package is written against the current types and therefore moves when they move,
which is exactly what you want for testing today's shape and exactly wrong for testing
compatibility. A compatibility fixture that tracks the code cannot fail.

That fixture carries a POPULATED V1 funnel, including the stage ids `registered` and `paid-active` —
the two AVG-11 concluded a Jarvis surface must never publish. V1 accepted them, a client parsed them,
and V1 goes on accepting them. **Correcting the contract is not licence to break the old one.**

### 2. V2 is a version successor in the same package, not a second contract

`contract/snapshot-v2.ts` sits beside V1 in the same package, behind the same single-entry parse
boundary, sharing the same `primitives.ts`.

**Every row schema is IMPORTED from V1 rather than restated.** A metric, an approval row, a worker
node, an agent and a roadmap marker mean at V2 exactly what they mean at V1, and cannot drift into
meaning something else. Sixteen of eighteen sections are V1's, definition and all. What V2 changes is
stated in one place each — the funnel stage union and the added readiness section — so the entire
delta between the versions is readable without diffing two files.

The one duplication is deliberate: V1's cross-field invariants (`unreadable is not empty`, the
source/freshness combinations, unique agent ids) live inside V1's own `superRefine`, and extracting
them into a shared helper would edit the file this ADR exists to leave alone. They are restated in
V2, and a spec drives the SAME violations through BOTH parsers and requires both to refuse — so the
duplication is a tested property rather than a place for the versions to quietly disagree.

### 3. Two parsers, and deliberately no dispatcher

The package root grows from four runtime symbols to six: a second version literal and a second parse
function. Nothing else — no schema, no builder, no mutator.

There is deliberately **no** `parseControlPlaneSnapshot(version)`. A single entry point taking a
version is one `??` away from validating a payload against the wrong contract and calling it valid. A
caller states which contract it speaks by choosing a function.

Version is checked before shape in both directions: a V1 payload handed to the V2 parser is told it
is a version mismatch rather than handed a list of V2 field errors, and vice versa. That symmetry is
what makes an upgrade legible from either side of it.

### 4. One build, two wire shapes — and still no self-fetch

The Jarvis OS server layer is factored so that **everything above `sections`** — the composed source
observations, the derived provenance block, the authority boundary, rollout, system, capabilities,
agents, roadmap — is produced once, by one function, from one collection per request.
`buildControlPlaneSnapshot` and `buildControlPlaneSnapshotV2` differ only in the final wire SHAPING.

A V2 that re-derived provenance, re-declared the authority boundary or re-composed sources would be a
second source of truth wearing a version number, and the two would drift the first time one was
edited. **A version decides the shape of a payload. It does not get its own idea of what is true.**

The funnel is REPLACED at V2 rather than converted, because there is no honest conversion: inventing
an authority for a V1 row that never carried one is the exact fabrication AVG-11 exists to prevent,
and silently dropping the rows would be worse. If composition ever produces V1 funnel rows, V2 throws
— the same treatment `composeSections` gives any structural failure, because a composition that would
have to guess is not trustworthy anywhere.

`loadControlPlaneSnapshotV2` is a sibling of `loadControlPlaneSnapshot` over one shared
`collectForRequest`. The server-rendered pages call it **directly**. JOS-01E's property survives the
split intact: the page and the routes are callers of one path, not paths that happen to agree today,
and no server component fetches its own HTTP route.

### 5. `/v2/snapshot`, and `/v1/snapshot` unchanged

`GET /api/control-plane/v2/snapshot` is added. It holds no logic of its own: the same
`requireApiOperatorSession` check close to the data, the same query rejection, the same failure body,
the same headers. **A new VERSION is a new shape, never new authority** — it exports `GET` alone, and
an unexported method is answered `405` by the framework.

The route-file lock moves from three to four, which is the kind of change that lock exists to make
somebody state out loud.

### 6. What V2 does NOT change

No new authority field at any version: still no `canSend`, `canExecute`, `isAuthorized`,
`consentValid`, `approvalGranted` or `dispatchAllowed`, every object still `.strict()`,
`rollout.enabled` still the literal `false`, still no methods. No credential field, no contact
detail, no unbounded value — the prohibitions ADR-0086 declared "at every version" bind here.

No live source is adopted, no Core is connected, no persistence, no migration, no model call, no
provider and no execution. `ADOPTED_READ_SOURCES` is still empty.

---

## Mutation findings

Ten mutations attack the version boundary specifically. Each was applied to the working tree, the
affected suite was actually executed, and the file was restored byte-identically (verified by SHA-256
against the pre-mutation digest, never by git). They ran alongside AVG-11's own twenty-one
(ADR-0128), for thirty-one in total. **Survivors: 0.**

| #   | Mutation                                                      | Caught by                                                 |
| --- | ------------------------------------------------------------- | --------------------------------------------------------- |
| 22  | The readiness section edited INTO V1 in place                 | the golden pre-AVG-11 fixture, and the V1-untouched specs |
| 23  | V1's funnel stage tightened in place to the AVG-11 vocabulary | the golden fixture — the very failure this ADR corrects   |
| 24  | The V2 parser's version check dropped, so it accepts V1       | the version-mismatch specs, both directions               |
| 25  | The V2 readiness section made optional                        | "V2 REQUIRES the Aarohi readiness section"                |
| 26  | An unavailable V2 funnel stage allowed to carry a value       | the unknown-is-not-zero specs at the wire                 |
| 27  | A V2-restated shared invariant dropped (unique agent ids)     | the both-parsers invariant specs                          |
| 28  | The V1 route repointed at the V2 loader                       | "V1 emits V1 only", and the V1 payload scan               |
| 29  | A `POST` handler added to the V2 route                        | the V2 route method lock, and the auth suite              |
| 30  | The V2 route's session check removed                          | the V2 401 specs in `auth-http.test.ts`                   |
| 31  | The Aarohi page made to self-fetch its own route              | the app-wide no-network source scan                       |

Mutations 22 and 23 are the ones worth reading. They reproduce, exactly, the defect this ADR exists
to correct — and they now fail, because the golden fixture is a frozen literal that does not move
when the types move.

---

## Consequences

Two contract versions now exist, and that is a real cost: two parsers, two fixtures, one restated
invariant block, and a second route to keep honest. It is the cost ADR-0086 chose deliberately when
it wrote the rule, and paying it here is cheaper than the alternative — a client, on a device, that
can no longer read the surface it was built against.

The V1 surface is now genuinely frozen rather than merely described as frozen, and there is a golden
fixture that will fail if anybody edits it again. The next contract change has a worked example to
follow.

Production rollout remains **OFF**. Aarohi's runtime remains **PLANNED / DISABLED**. Only a future
activating ADR may change either.
