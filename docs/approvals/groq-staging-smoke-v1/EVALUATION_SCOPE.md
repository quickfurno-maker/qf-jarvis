# Evaluation Scope — Groq Staging Smoke v1

**Reference:** `eval.qfj.synthetic-connectivity-smoke.v1`
**Approval date:** 2026-07-28
**Slice:** QFJ-S1C

---

## 1. Owner scope statement (verbatim)

> “The evaluation reference approves only the synthetic staging connectivity smoke. It does not
> approve production quality, production activation, rollout, real customer data, WhatsApp, n8n,
> QuickFurno Core access, database access, or deployment.”

## 2. What this reference covers

**Connectivity and contract validation only.** It answers exactly two questions:

1. Can the harness reach the fixed Groq Chat Completions endpoint with the approved release identity
   and the approved credential reference?
2. Does the response satisfy the strict structured-output contract?

Nothing else is in scope.

## 3. Expected schema

Sent as `response_format.json_schema` with `strict: true`:

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": { "probe": { "type": "string" } },
  "required": ["probe"]
}
```

An object with a **required string field `probe`** and **no additional properties**.

## 4. Expected semantic result

```json
{ "probe": "ok" }
```

The value is validated structurally and then **discarded**. It is never printed, logged, persisted,
or reported. A response that fails the strict shape is `smoke-provider-malformed`.

## 5. What this reference explicitly does NOT approve

This is a wire probe, not a quality measurement. It approves **none** of the following:

- production quality of any kind;
- answer correctness, helpfulness, or usefulness beyond the literal probe shape;
- safety, red-team, jailbreak, or abuse resistance;
- sales behaviour;
- customer-care behaviour;
- language, tone, or localisation quality;
- latency SLOs or any performance guarantee;
- cost, spend, or budget characteristics;
- concurrency, throughput, or rate-limit behaviour;
- production activation, rollout promotion, or provider registration;
- real customer, client, or vendor data;
- WhatsApp, n8n, QuickFurno Core, database access, or deployment.

## 6. Evidence status

This reference records an **owner approval of scope**. It is not a measurement.

No evaluation suite has been executed against the live model, no observation has been collected, and
S1C made no request. A future real evaluation record (ADR-0052) would be separate evidence requiring
its own authorization.

The probe input is a fixed synthetic literal compiled into the harness. It contains no client, vendor,
or subject data — no contact detail, no order, no history, nothing whose disclosure would matter.
