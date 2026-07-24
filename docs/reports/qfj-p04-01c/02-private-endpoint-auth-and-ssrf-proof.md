# Report 02 — Private-Endpoint, Auth, and SSRF Proof

**Slice:** QFJ-P04.01C — Local OpenAI-Compatible Adapter. **ADR:** [ADR-0047](../../decisions/ADR-0047-qfj-p04-01c-local-openai-compatible-adapter.md).

A local model server lives on a private network reachable by IP, so the dominant risk is SSRF. This report proves the endpoint policy admits only explicit private destinations and that the optional token never escapes the transport boundary.

## The endpoint validator — private IP literals only

`createLocalEndpoint(rawBaseUrl, options)` parses the base URL and validates it before producing a frozen `LocalEndpointDescriptor`. It resolves **no DNS**. It **allows** only:

| Family | Range                                        | Category          |
| ------ | -------------------------------------------- | ----------------- |
| IPv4   | `127.0.0.0/8`                                | `ipv4-loopback`   |
| IPv4   | `10/8`, `172.16/12`, `192.168/16`            | `ipv4-private`    |
| IPv4   | `100.64.0.0/10`                              | `ipv4-cgnat`      |
| IPv6   | `::1`                                        | `ipv6-loopback`   |
| IPv6   | `fc00::/7`                                   | `ipv6-ula`        |
| IPv6   | `fe80::/10` — **only** with `allowLinkLocal` | `ipv6-link-local` |

It **rejects**, each proven by a dedicated test: public IPv4 (`8.8.8.8`, `1.1.1.1`), public IPv6 (`2606:4700:4700::1111`), hostnames (`example.com`, `localhost`), embedded credentials (`user:pass@…`), query strings, fragments, explicit paths, non-`http(s)` schemes (`ftp`, `ws`), IPv4 link-local (`169.254/16`), IPv6 link-local without opt-in, **IPv4-mapped public IPv6** (`::ffff:8.8.8.8`), unspecified (`0.0.0.0`), broadcast (`255.255.255.255`), multicast (`224.0.0.1`), malformed IPv4 (`256.1.1.1`), malformed IPv6 (`gggg::1`), and port `0`.

The validator classifies an IPv4-mapped address by its **embedded** IPv4 — a mapped public address is rejected while a mapped loopback would be treated as loopback — closing the classic mapped-address bypass. The `LocalEndpointDescriptor` is a **branded class**: `createLocalProviderConfig` checks `instanceof`, so a hand-forged plain object claiming to be "local" cannot pose as a validated endpoint (proven by the forged-endpoint test).

## Scheme / transport-layer rules

- **Plain HTTP** is permitted only for **loopback**, or for a non-loopback private address when `allowPlainHttpNonLoopback` is explicitly set (an attested private-network composition). A non-loopback plain-HTTP endpoint without attestation is rejected (proven). HTTPS is preferred for non-loopback.
- The final request URL is **constructed internally** as `${origin}/v1/chat/completions`; the caller cannot supply a path.
- The production transport (`createFetchLocalTransport(endpoint)`) is the single `fetch`. It **refuses any URL other than the descriptor's `chatCompletionsUrl`** (SSRF guard — proven by the mismatched-URL rejection test), sets `redirect: 'error'`, and bounds the response before reading. A redirect that would leave the private envelope is therefore an error, not a followed hop.
- Tests inject a transport **function** — never an endpoint bypass — so the production validator always runs for a real endpoint.

## The optional auth token — confined and redacted

`LocalAuthToken` holds the value in a private `#value` field; `toString`, `toJSON`, and Node's inspect hook all return `[REDACTED_LOCAL_AUTH_TOKEN]`. The value is readable **only** through `authorizationHeaderValue()`, called only by the provider to set the transport request header. Proven with a **sentinel** token (`local_SENTINEL_test_token_do_not_use_0000` — grants nothing):

- `String(token)`, `token.toJSON()`, `JSON.stringify({ token })` never contain the sentinel.
- `JSON.stringify(config)` never contains the sentinel (the frozen config redacts the held token).
- On a `401` failure, the result, the provider descriptor, and the capabilities never contain the sentinel.
- Through the gateway, the response never contains the sentinel (nor the Groq key).

The token is **optional**: a loopback dev server may use none, in which case the adapter sends **no** Authorization header (proven). There is **no `process.env`** access and **no secret loader** anywhere in the package; the token is injected at composition only.
