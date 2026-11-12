# Anisha — English/Hinglish local-model tuning readiness (2026-11-12)

**Scope:** Offline Anisha candidate only. **No production prompt, model provider, WhatsApp routing, deployment, training weights, or data source is changed.**

## Owner's language decision

Anisha's _generated responses_ may be **English** or **Roman-script Hinglish** only.

- English-language vendor message → concise natural English.
- Roman-script Hinglish message → natural Roman-script Hinglish, avoiding stiff formal Hindi.
- Any other language, including Marathi and Devanagari Hindi → default to concise English, with no unsupported translation claims.
- No English-to-Marathi, Roman-Marathi, or Devanagari reply mode.
- Never choose another agent or relax Core authority due to requested language.

This is a target policy for the next model/prompt candidate; the current production V1 prompt is unchanged.

## Reused data, no regeneration

Existing input bundle: `D:\qf-jarvis-cloud-training-bundle\data\anisha`. Metadata provides `language: ENGLISH|HINGLISH` under `metadata`, not on the JSONL root.

| Split         |    English |   Hinglish |      Total |
| ------------- | ---------: | ---------: | ---------: |
| train         |     24,622 |     24,879 |     49,501 |
| validation    |      2,775 |      2,724 |      5,499 |
| boundary_eval |      2,548 |      2,452 |      5,000 |
| **Total**     | **29,945** | **30,055** | **60,000** |

Read-only verification on the connected JARVIS PC:

- All three original gzip SHA-256 and decompressed SHA-256 digests match `manifest.json`.
- No duplicate IDs across the three splits, no non-Anisha rows, and no unknown language metadata.
- All **439,608 assistant turns** in train/validation passed the basic Roman-script check (zero detected Devanagari turns).
- `boundary_eval` cases are user-only safety prompts; they are evaluation inputs **not** supervised answer targets.

Command:

```powershell
python scripts/anisha_language_gate.py --bundle "D:\qf-jarvis-cloud-training-bundle\data"
```

**Limits:** Metadata and script checks cannot prove that all Hinglish is semantically correct or that every Romanized sentence isn't another language. They also do not evaluate security, hallucinations, vendor business rules, training-data rights, or model quality.

## Hardware observation

Connected JARVIS device reports AMD Radeon 860M graphics, 24 GB system RAM, Python/uv installed, and no NVIDIA CUDA toolchain detected. **No trained Anisha weights or locally serving model was verified.** Large supervised LoRA/QLoRA training cannot be assumed viable on this Windows machine. Local inference needs separate engine/model evaluation.

## Next candidate-only steps

1. Audit source provenance, consent and training eligibility for the existing bundle. Freeze IDs and hashes.
2. Add a **separate** Anisha V2 candidate prompt and English/Hinglish response evaluations. Do not modify reviewed V1 bytes/digest or add V2 to the production registry.
3. Evaluate representative human-rated dialogues, especially mixed-language clarity, scope, OTP/document safety, verification, refunds-as-credit only, lead response, payment claims, abuse and prompt injection.
4. Select one compatible licensed base model, tokenize/test on a small sample, train a bounded LoRA/QLoRA adapter using compatible GPU compute, and compare to untuned baseline on the held-out validation and boundary sets.
5. Export a quantized local-inference candidate, verify on actual JARVIS hardware for latency, memory use, structured-output conformity and accuracy, then certify under existing Core authority, privacy, signed transports, human takeover and production evidence gates.

**Status:** Corpus language/integrity gate **PASS**. Model training **NOT STARTED**. Local model **NOT DEPLOYED**. Production remains **HOLD**.
