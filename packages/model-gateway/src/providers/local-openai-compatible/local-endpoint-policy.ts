/**
 * Private-endpoint policy for the local OpenAI-compatible adapter (QFJ-P04.01C, ADR-0047).
 *
 * A local model server lives on a private network reachable by IP, so the dominant risk is SSRF — an
 * arbitrary destination masquerading as "local". This module is the guard: it validates a base URL down
 * to an explicit PRIVATE IP LITERAL and constructs the fixed `/v1/chat/completions` URL internally. It
 * rejects public addresses, hostnames (by default), embedded credentials, query strings, fragments,
 * arbitrary paths, non-http(s) schemes, unsupported ports, malformed or IPv4-mapped-public IPv6, and
 * unspecified/multicast/broadcast addresses. It resolves no DNS. Tests inject a transport, never an
 * endpoint bypass, so this validator always runs for a production endpoint.
 */

/** The fixed Chat Completions path appended to a validated private base. Not overridable. */
export const LOCAL_CHAT_COMPLETIONS_PATH = '/v1/chat/completions';

/** The classification of an accepted private destination. `*-loopback` also drives the plain-HTTP rule. */
export type LocalAddressCategory =
  | 'ipv4-loopback'
  | 'ipv4-private'
  | 'ipv4-cgnat'
  | 'ipv6-loopback'
  | 'ipv6-ula'
  | 'ipv6-link-local';

/**
 * A validated, frozen private endpoint. Constructed ONLY by {@link createLocalEndpoint}, so a downstream
 * `instanceof` check proves the endpoint passed the policy — a hand-forged plain object cannot pose as one.
 * The Chat Completions URL is built here, once, from the validated base.
 */
export class LocalEndpointDescriptor {
  public readonly scheme: 'http' | 'https';
  public readonly category: LocalAddressCategory;
  public readonly isLoopback: boolean;
  /** The normalized base origin (scheme + host + port), no path/query/fragment/credentials. */
  public readonly baseUrl: string;
  /** The only URL the adapter will ever request: `${baseUrl}${LOCAL_CHAT_COMPLETIONS_PATH}`. */
  public readonly chatCompletionsUrl: string;

  /** @internal — use {@link createLocalEndpoint}. */
  public constructor(fields: {
    scheme: 'http' | 'https';
    category: LocalAddressCategory;
    isLoopback: boolean;
    baseUrl: string;
  }) {
    this.scheme = fields.scheme;
    this.category = fields.category;
    this.isLoopback = fields.isLoopback;
    this.baseUrl = fields.baseUrl;
    this.chatCompletionsUrl = `${fields.baseUrl}${LOCAL_CHAT_COMPLETIONS_PATH}`;
    Object.freeze(this);
  }
}

/** Options that widen the default-closed policy only for explicitly attested private uses. */
export interface LocalEndpointOptions {
  /** Permit IPv6 link-local (`fe80::/10`) for a bounded local use. Off by default. */
  readonly allowLinkLocal?: boolean;
  /** Permit plain HTTP to a non-loopback private address (attested private network). Off by default. */
  readonly allowPlainHttpNonLoopback?: boolean;
}

class EndpointError extends Error {}

/** Parse a strict dotted-quad IPv4 into 4 octets, or null. Rejects leading zeros and out-of-range. */
function parseIPv4(host: string): number[] | null {
  const parts = host.split('.');
  if (parts.length !== 4) {
    return null;
  }
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    if (part.length > 1 && part.startsWith('0')) {
      return null;
    }
    const n = Number(part);
    if (n > 255) {
      return null;
    }
    octets.push(n);
  }
  return octets;
}

/** Parse an IPv6 literal (optionally with an embedded IPv4 tail) into 16 bytes, or null. */
function parseIPv6(host: string): number[] | null {
  let text = host;
  const embeddedV4Bytes: number[] = [];
  // An embedded IPv4 tail (`::ffff:127.0.0.1`) contributes the final two hextets.
  if (text.includes('.')) {
    const lastColon = text.lastIndexOf(':');
    if (lastColon < 0) {
      return null;
    }
    const v4 = parseIPv4(text.slice(lastColon + 1));
    if (v4 === null) {
      return null;
    }
    embeddedV4Bytes.push(...v4);
    text = text.slice(0, lastColon + 1) + '0:0';
  }

  const doubleColon = text.split('::');
  if (doubleColon.length > 2) {
    return null;
  }
  const toHextets = (segment: string): number[] | null => {
    if (segment === '') {
      return [];
    }
    const out: number[] = [];
    for (const piece of segment.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(piece)) {
        return null;
      }
      out.push(Number.parseInt(piece, 16));
    }
    return out;
  };

  let hextets: number[];
  if (doubleColon.length === 2) {
    const left = toHextets(doubleColon[0] ?? '');
    const right = toHextets(doubleColon[1] ?? '');
    if (left === null || right === null) {
      return null;
    }
    const missing = 8 - left.length - right.length;
    if (missing < 1) {
      return null;
    }
    hextets = [...left, ...Array<number>(missing).fill(0), ...right];
  } else {
    const all = toHextets(text);
    if (all === null) {
      return null;
    }
    hextets = all;
  }
  if (hextets.length !== 8) {
    return null;
  }

  const bytes: number[] = [];
  for (const hextet of hextets) {
    bytes.push((hextet >> 8) & 0xff, hextet & 0xff);
  }
  // If an IPv4 tail was present, overwrite the trailing two hextets with its bytes.
  if (embeddedV4Bytes.length === 4) {
    bytes[12] = embeddedV4Bytes[0] ?? 0;
    bytes[13] = embeddedV4Bytes[1] ?? 0;
    bytes[14] = embeddedV4Bytes[2] ?? 0;
    bytes[15] = embeddedV4Bytes[3] ?? 0;
  }
  return bytes;
}

/** Classify an IPv4 into an accepted private category, or null to reject (public/unspecified/etc.). */
function classifyIPv4(octets: number[]): LocalAddressCategory | null {
  const [a, b] = octets as [number, number, number, number];
  if (a === 0) {
    return null; // 0.0.0.0/8 unspecified / "this host"
  }
  if (a === 127) {
    return 'ipv4-loopback';
  }
  if (a === 10) {
    return 'ipv4-private';
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return 'ipv4-private';
  }
  if (a === 192 && b === 168) {
    return 'ipv4-private';
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return 'ipv4-cgnat';
  }
  // Everything else — public, link-local 169.254, multicast 224-239, broadcast 255 — is rejected.
  return null;
}

/** Classify 16 IPv6 bytes into an accepted private category, or null to reject. */
function classifyIPv6(bytes: number[], allowLinkLocal: boolean): LocalAddressCategory | null {
  // IPv4-mapped (::ffff:0:0/96) — classify by the embedded IPv4 so a mapped PUBLIC address is rejected.
  const isV4Mapped =
    bytes.slice(0, 10).every((x) => x === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  if (isV4Mapped) {
    const v4 = classifyIPv4(bytes.slice(12, 16));
    return v4; // mapped-public → null (reject); mapped-private → the v4 category
  }
  const allZero = bytes.every((x) => x === 0);
  if (allZero) {
    return null; // :: unspecified
  }
  const isLoopback = bytes.slice(0, 15).every((x) => x === 0) && bytes[15] === 1;
  if (isLoopback) {
    return 'ipv6-loopback';
  }
  const first = bytes[0] ?? 0;
  const second = bytes[1] ?? 0;
  if (first === 0xff) {
    return null; // ff00::/8 multicast
  }
  if ((first & 0xfe) === 0xfc) {
    return 'ipv6-ula'; // fc00::/7 unique-local
  }
  if (first === 0xfe && (second & 0xc0) === 0x80) {
    return allowLinkLocal ? 'ipv6-link-local' : null; // fe80::/10 link-local, opt-in only
  }
  return null; // global unicast / anything else
}

/**
 * Validate a base URL to an explicit private IP literal and build the fixed Chat Completions URL. Throws
 * a fixed-message error (never echoing a credential) on any violation. Resolves no DNS; admits IP
 * literals only. The returned descriptor's `chatCompletionsUrl` is the ONLY URL the transport may request.
 */
export function createLocalEndpoint(
  rawBaseUrl: string,
  options: LocalEndpointOptions = {},
): LocalEndpointDescriptor {
  if (typeof rawBaseUrl !== 'string' || rawBaseUrl.length === 0 || rawBaseUrl.length > 2048) {
    throw new EndpointError('A local endpoint must be a bounded URL string.');
  }
  let url: URL;
  try {
    url = new URL(rawBaseUrl);
  } catch {
    throw new EndpointError('A local endpoint URL is malformed.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new EndpointError('A local endpoint must use http or https.');
  }
  if (url.username !== '' || url.password !== '') {
    throw new EndpointError('A local endpoint must not embed credentials.');
  }
  if (url.search !== '' || url.hash !== '') {
    throw new EndpointError('A local endpoint must not carry a query string or fragment.');
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new EndpointError('A local endpoint must not carry a path.');
  }

  const scheme = url.protocol === 'https:' ? 'https' : 'http';

  // Reject an explicit port of 0; a valid explicit port is 1..65535. An empty port means the scheme default.
  if (url.port !== '') {
    const port = Number(url.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new EndpointError('A local endpoint port is unsupported.');
    }
  }

  const rawHost = url.hostname;
  let category: LocalAddressCategory | null;

  if (rawHost.startsWith('[') && rawHost.endsWith(']')) {
    const inner = rawHost.slice(1, -1);
    const bytes = parseIPv6(inner);
    if (bytes === null) {
      throw new EndpointError('A local endpoint IPv6 address is malformed.');
    }
    category = classifyIPv6(bytes, options.allowLinkLocal === true);
  } else {
    const octets = parseIPv4(rawHost);
    if (octets === null) {
      // Not an IP literal: a hostname (or malformed). Hostnames are deferred (DNS-rebinding risk).
      throw new EndpointError(
        'A local endpoint must be a private IP literal (hostnames are not permitted).',
      );
    }
    category = classifyIPv4(octets);
  }

  if (category === null) {
    throw new EndpointError('A local endpoint must be a permitted private address.');
  }

  const isLoopback = category === 'ipv4-loopback' || category === 'ipv6-loopback';
  if (scheme === 'http' && !isLoopback && options.allowPlainHttpNonLoopback !== true) {
    throw new EndpointError('Plain HTTP to a non-loopback private endpoint requires attestation.');
  }

  // `url.origin` is the normalized scheme://host[:port] with no path/query/fragment/credentials.
  return new LocalEndpointDescriptor({ scheme, category, isLoopback, baseUrl: url.origin });
}
