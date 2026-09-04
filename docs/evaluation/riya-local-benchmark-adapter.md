# Riya local model benchmark adapter

**Slice:** AS4-PREP-A · **Package:** `@qf-jarvis/riya-model-benchmark-local-adapter` · **Companions:** [benchmark foundation](./riya-model-benchmark-foundation.md), [benchmark harness](./riya-benchmark-harness.md), [measurement policy v1](./riya-benchmark-measurement-policy-v1.md), [selection protocol](./riya-model-selection-protocol.md)

**No model has been downloaded, benchmarked or selected.** This slice builds the adapter. Every engine
it has ever spoken to is a scripted fake or a few lines of `node:http` started by a test, and no
candidate model exists on any machine this repository controls.

---

## What RMB-B left, and what this fills

RMB-B ended with a scheduler, two ports and no real target. Its header said, in as many words, that a
real provider or local-engine adapter was a later slice implemented **behind** the target port — "and
emphatically not by adding benchmark instrumentation to the production model gateway, which is the
serving waist".

This is that adapter. Nothing in RMB-A, RMB-B or the gateway changed to admit it. Two containment
specs were widened to name this package as an authorised **offline** importer, and both still refuse
every runtime, application and gateway; the spec proving the gateway names no benchmark concept is
untouched and now has a second copy in this package, because this was the slice that could have taken
the shortcut.

## The network boundary is a value, not a review rule

A destination is a `RiyaLocalEngineEndpointV1`, and only the endpoint constructor can produce one. It
accepts exactly three spellings over plain `http` with an explicit port:

```
http://127.0.0.1:<port>    http://localhost:<port>    http://[::1]:<port>
```

optionally with a short path prefix such as `/v1`. Everything else is refused: `https` (including to a
loopback address), any other hostname, LAN and public addresses, `0.0.0.0`, a URL carrying a username
or password, a URL carrying a query string or fragment, a missing port, and any path segment that is
not a plain name.

Callers hand the transport a **path** from a closed two-entry list, never a URL. So the layer that
decides _what_ to send cannot decide _where_, and the layer that decides where cannot be aimed off the
loopback interface. The URL is re-proved immediately before the socket opens, which is what makes a
forged endpoint value — from a cast, a `JSON.parse` or a future refactor — fail rather than be believed.

**Redirects are refused, not followed.** `redirect: 'manual'` turns off automatic following, and a 3xx
is refused at the transport and again at the adapter. Automatic following is precisely how a
loopback-only guarantee becomes untrue at run time: the first URL is checked, and the second — chosen
by whatever answered — never is.

**There is no credential surface.** No `apiKey`, no `authorization` header, no bearer token, no header
input, no credential environment variable and no remote base-URL escape hatch. Not unused — absent, so
there is no field a future slice could fill without changing a signature and a reviewer's mind.

### The honest limit

`localhost` is a _name_, resolved by the operating system. A machine whose hosts file maps it elsewhere
would send the request elsewhere, and no parsing can see that. The two literal forms have no such gap.
The name is accepted anyway, because refusing the spelling every local engine prints on startup pushes
an operator toward editing the check rather than the URL — and `hostForm` records which spelling was
used, so a run can say what it actually trusted.

## Model identity: the served model _is_ the release

`subject.release` is RMB-A's, which is `model-evaluation`'s. There is no separate `servedModelName`
field, and that absence is the point: two plausible strings six lines apart, one measured and one
stamped, is a forgery no reviewer would see. The operator launches the engine under the exact catalogue
id, and the adapter sends exactly that.

Beyond the release grammar's refusal of `*` and a `latest` segment, local serving adds spellings a
hosted catalogue does not have: `default`, `auto`, `any`, `current`, `stable`, `model`, `local`. Each
names whatever the engine happened to load, so each is refused. A name that merely _contains_ one —
`base.alpha-default-tune` — is fine; this is governance, not grammar.

Identity is then held at run time in two places. `verifyServedModel()` reads `/models` before the suite
starts — **pre-benchmark control traffic**, outside every measured window and every percentile — and
requires the exact id to be present: no prefix match, no nearest match, and no "it is the only model
loaded, so it must be the one". And **every streamed chunk** is checked, so a substitution that appears
after the first token is caught too.

## Prompts are synthetic, closed and generated

Benchmark text comes from a registry inside this package: three profiles (`short`, `medium`, `long`),
generated deterministically from a neutral lexicon by a seeded generator, with no digits, no brand, no
person and no business content.

The pull at this exact point is toward realism, and the most realistic Riya prompts in the repository
are the Human Gold corpus and the protected P10 exam. A benchmark that could read either would be a
second, ungoverned copy of both, outside every firewall built for them and committed as "just
fixtures". So there is no code path from a dataset, a prompt registry, a CRM record or a production
system prompt into a benchmark request — proved by a spec that scans raw source.

The cost is stated rather than hidden: these profiles measure how an engine handles a prompt of a given
_shape and size_, not how it handles a real sales conversation. That is the right thing for an
operational benchmark to measure — latency is a function of token counts and structure — and
conversational quality remains P10's authority on evidence this package never produces.

Lines never repeat within a profile. A repeated turn would let an engine's prefix cache answer a later
request for free, and the resulting number reads as a very fast model rather than as a broken prompt.

**The digest is proved before warmup.** `prepareCase` materializes the bytes, hashes them, and refuses
the case if the result is not the digest the plan declared. RMB-B independently compares the returned
digest, so the guarantee survives the adapter's own check being deleted.

## Token counts are exact or absent

**Input.** The engine's own tokenizer, through an injected `RiyaLocalTokenizerPort`. The shipped
implementation sends one non-streamed completion of the same messages with `max_tokens: 1` and reads
`usage.prompt_tokens` — the same engine, the same model, the same chat template, the same messages, so
it is the number itself rather than an estimate of it. It costs one generated token per case and is
pre-benchmark control traffic.

A tokenizer library was rejected: its answer is not the number the benchmark consumes, because the
engine applies its own chat template first, and the template is a property of the model repository, the
engine version and the launch flags. It would also drag a downloaded tokenizer file into a package
whose whole claim is that it downloads nothing. **No count derived from character length appears
anywhere.**

**Output.** Declared in the configuration as either `SERVER_REPORTED_USAGE` — the engine's own
`usage.completion_tokens`, strictly validated — or `LOCAL_TOKENIZER_COUNT`, an exact count of the
generated text. There is no third mode: "estimate from characters" would put a number that is not a
token count into a field called `outputTokens`, and it is the number a throughput figure is divided by.
A stream that produced output but reported no usable count is a refusal, not a guess.

`countOutputTokens` is **optional** on the port and absent from the shipped tokenizer, because an
OpenAI-compatible surface exposes no uniform way to tokenize arbitrary assistant text. A configuration
asking for local output counting without a counter that can do it is refused at construction rather
than quietly falling back to the server's number under a label saying otherwise.

**Generated text is counted and dropped.** It is never persisted, logged, attached to an error or
returned — RMB-B's invocation result has no field it would fit in, and its firewall would refuse one.

## Time to first token

`onFirstOutput` fires on the first **non-empty content delta**, exactly once. Not on the response
headers, not on the role-only chunk every engine sends first, not on an empty or null content, not on
the usage chunk, and not on the finish event. Each of those arrives before real output on at least one
engine, and marking any of them would make TTFT a measurement of the response header.

The decoder is fed **bytes, not events**: one event can arrive in three chunks and three events in one,
and a per-chunk parser misses the first token under load — which is a TTFT that is silently wrong
rather than a crash somebody notices. A spec cuts a single event in half to prove it.

A 200 that produced no output token at all is a protocol failure, not a very fast request.

## Deadlines and cancellation abort the request

The per-request deadline and the suite cancellation are composed into one `AbortSignal` that reaches
`fetch` and therefore the socket. **There is no `Promise.race` anywhere.** A race would resolve the
invocation while the engine kept generating, RMB-B would free the concurrency slot, and the next
request would be admitted against a machine still busy with the last one — a throughput figure that is
real, plausible and wrong.

Every path closes the response stream in a `finally` and settles only after it is closed. A timeout is
**data** — an ordinary `FAILURE`, as RMB-B's port asks. A suite cancellation is **not**: it throws,
because a cancelled request has no latency to report and recording it as a failure would put the
operator who pressed Ctrl-C into the success rate.

RMB-B says the adapter enforces the **exact** deadline. A JavaScript timer resolves in milliseconds, so
a plan whose `requestTimeoutMicros` is not a whole number of milliseconds is **refused** rather than
rounded — two plans differing by 500 microseconds would otherwise compare as equal while having
abandoned slow requests at the same moment.

## Memory is not reported

There is no honest engine-independent way to read peak accelerator memory over an OpenAI-compatible
socket. Process RSS is not VRAM, a model file size is not a working set, and a parameter count is not a
measurement. RMB-B makes the probe optional; this adapter supplies none, and the observation carries no
memory rather than a fabricated zero that would sit in a comparison table beside real readings.

The run manifest says `acceleratorMemoryMeasured: false` explicitly, because an absent column invites
somebody to assume it was zero. A hardware-specific probe is a later slice.

## The CLI

```
pnpm riya:benchmark:local -- --plan <path> --config <path> --endpoint <loopback-url> \
                            --artifacts <dir> [--execute] [--allow-overwrite]
```

All four arguments are required in both modes. **Without `--execute` nothing is sent**: the endpoint,
the configuration and every case of the plan are proved, a summary is printed, and no transport is ever
constructed. Almost every mistake in a benchmark run lives in the plan or the configuration, and the
dry run finds all of them in a second without occupying a GPU.

Nothing is discovered and nothing is defaulted: no configuration discovery, no environment read, no
default endpoint, no default model, no fallback. A run that could pick up settings from its
surroundings is a run whose evidence cannot be reproduced from what somebody typed.

The printed summary carries refs, counts, digests and case shapes — never a prompt, a completion, a
header, an engine error body, a URL or a filesystem path. Failures print a closed code from this
package or from RMB-B, because the line ends up in a CI transcript.

Two artifacts are written atomically, and an existing one is never silently replaced: the canonical
RMB-A **result set**, and a sanitized **run manifest** carrying the prompt-profile bindings, the token
accounting mode, the digests and which loopback spelling was proved. The manifest has no field for a
host, a port, a URL or a path, and states `syntheticWorkload: true` / `productionApproval: false` as
literals.

## What it does not do

No model download, no tokenizer file, no dataset, no checkpoint, no fine-tune, no quantization, no
paid provider call, no database, no migration. It ranks nothing, scores nothing, recommends nothing and
approves nothing.

**No base model has been selected**, and this slice does not select one. The order is unchanged:
generic safety, then P10 Riya quality, then — among candidates that cleared both — operational
evidence, then an owner chooses. See the [selection protocol](./riya-model-selection-protocol.md).

Performance evidence and quality/safety evidence stay separate and joinable by exact release identity.
Merging them would produce a single number in which a fast model with a bad refusal rate outranks a
slower correct one, and the arithmetic would hide it.

## What is still missing before AS4 can run

- A candidate matrix: which releases, at which quantizations, under which engine configuration. That
  is an owner-reviewed artifact and does not exist.
- Hardware. Nothing in this repository has run a local open-weight model.
- An honest accelerator memory probe.
- The quality and safety evidence that gates a candidate before its latency matters at all.
