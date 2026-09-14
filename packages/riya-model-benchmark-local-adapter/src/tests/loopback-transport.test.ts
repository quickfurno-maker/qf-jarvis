/**
 * The real transport, against an ephemeral server this spec starts and stops on 127.0.0.1.
 *
 * ### Why a real server rather than a mocked `fetch`
 *
 * The three things this transport must get right are all below the level a mock reproduces: that a
 * redirect is refused rather than followed, that an abort closes the connection rather than
 * abandoning a promise, and that a multi-byte character split across two TCP writes still decodes.
 * A stubbed `fetch` would agree with whatever the implementation did.
 *
 * No model, no engine, no download and no traffic leaving the machine: the server is a few lines of
 * `node:http` bound to the loopback interface on an ephemeral port, and it is closed in `afterEach`.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { createRiyaLocalEngineEndpoint } from '../contracts/endpoint.js';
import { createRiyaLoopbackEngineTransport } from '../service/loopback-transport.js';

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

let server: Server | undefined;

async function startServer(handler: Handler): Promise<string> {
  const created = createServer(handler);
  server = created;
  created.listen(0, '127.0.0.1');
  await once(created, 'listening');
  const address = created.address() as AddressInfo;
  return `http://127.0.0.1:${String(address.port)}`;
}

afterEach(async () => {
  if (server !== undefined) {
    const closing = server;
    server = undefined;
    closing.closeAllConnections();
    closing.close();
    await once(closing, 'close');
  }
});

async function collect(body: AsyncIterable<string>): Promise<string> {
  let text = '';
  for await (const chunk of body) {
    text += chunk;
  }
  return text;
}

describe('the loopback transport talks to a local server and nothing else', () => {
  it('sends a POST body and streams the response back', async () => {
    let received = '';
    const origin = await startServer((request, response) => {
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => {
        received += chunk;
      });
      request.on('end', () => {
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.write('data: {"a":1}\n\n');
        response.end('data: [DONE]\n\n');
      });
    });

    const transport = createRiyaLoopbackEngineTransport({
      endpoint: createRiyaLocalEngineEndpoint(origin),
    });
    const result = await transport.request({
      method: 'POST',
      path: '/chat/completions',
      body: '{"model":"vendor.alpha/base.alpha-14"}',
      signal: new AbortController().signal,
    });
    expect(result.status).toBe(200);
    expect(await collect(result.body)).toBe('data: {"a":1}\n\ndata: [DONE]\n\n');
    expect(received).toBe('{"model":"vendor.alpha/base.alpha-14"}');
  });

  it('sends NO credential header of any kind', async () => {
    let headers: Record<string, unknown> = {};
    const origin = await startServer((incoming, response) => {
      headers = { ...incoming.headers };
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"data":[]}');
    });
    const transport = createRiyaLoopbackEngineTransport({
      endpoint: createRiyaLocalEngineEndpoint(origin),
    });
    const result = await transport.request({
      method: 'GET',
      path: '/models',
      signal: new AbortController().signal,
    });
    await collect(result.body);
    for (const forbidden of [
      'authorization',
      'x-api-key',
      'api-key',
      'cookie',
      'proxy-authorization',
    ]) {
      expect(Object.keys(headers), forbidden).not.toContain(forbidden);
    }
  });

  it('REFUSES a redirect instead of following it', async () => {
    // The mechanism by which a loopback-only guarantee becomes untrue at run time: the first URL is
    // checked, and the second -- chosen by whatever answered -- never is.
    let followed = false;
    const origin = await startServer((request, response) => {
      if (request.url === '/chat/completions') {
        response.writeHead(302, { location: 'http://example.com/v1/chat/completions' });
        response.end();
        return;
      }
      followed = true;
      response.writeHead(200).end('{}');
    });
    const transport = createRiyaLoopbackEngineTransport({
      endpoint: createRiyaLocalEngineEndpoint(origin),
    });
    await expect(
      transport.request({
        method: 'POST',
        path: '/chat/completions',
        body: '{}',
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'ENGINE_REDIRECT_REFUSED' });
    expect(followed).toBe(false);
  });

  it('closes the connection when the request is aborted mid-stream', async () => {
    let closedByClient = false;
    const origin = await startServer((request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('data: {"a":1}\n\n');
      // Deliberately never ends. Only the client abort can finish this exchange.
      request.on('aborted', () => {
        closedByClient = true;
      });
      response.on('close', () => {
        closedByClient = true;
      });
    });

    const controller = new AbortController();
    const transport = createRiyaLoopbackEngineTransport({
      endpoint: createRiyaLocalEngineEndpoint(origin),
    });
    const result = await transport.request({
      method: 'POST',
      path: '/chat/completions',
      body: '{}',
      signal: controller.signal,
    });
    const iterator = result.body[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toBe('data: {"a":1}\n\n');
    controller.abort();
    await expect(iterator.next()).rejects.toBeDefined();
    await iterator.return?.();
    // Give the server one turn to observe the socket going away.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(closedByClient).toBe(true);
  });

  it('decodes a multi-byte character split across two writes', async () => {
    // A per-chunk `TextDecoder` turns this into a replacement character and the surrounding JSON stops
    // parsing -- which surfaces as an unexplained protocol failure under load and nowhere else.
    const bytes = Buffer.from('data: {"c":"é"}\n\n', 'utf8');
    const origin = await startServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(bytes.subarray(0, 12));
      setTimeout(() => {
        response.end(bytes.subarray(12));
      }, 10);
    });
    const transport = createRiyaLoopbackEngineTransport({
      endpoint: createRiyaLocalEngineEndpoint(origin),
    });
    const result = await transport.request({
      method: 'POST',
      path: '/chat/completions',
      body: '{}',
      signal: new AbortController().signal,
    });
    expect(await collect(result.body)).toBe('data: {"c":"é"}\n\n');
  });

  it('refuses a path outside the closed set before opening a socket', async () => {
    let reached = false;
    const origin = await startServer((_request, response) => {
      reached = true;
      response.writeHead(200).end('{}');
    });
    const transport = createRiyaLoopbackEngineTransport({
      endpoint: createRiyaLocalEngineEndpoint(origin),
    });
    await expect(
      transport.request({
        method: 'GET',
        path: '/shutdown',
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'ENDPOINT_INVALID' });
    expect(reached).toBe(false);
  });
});
