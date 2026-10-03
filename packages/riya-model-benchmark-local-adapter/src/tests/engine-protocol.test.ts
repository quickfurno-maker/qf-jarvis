/**
 * The event-stream decoder and the chunk projection boundary.
 *
 * ### Why these two are specified separately
 *
 * They are the layers where a real engine differs from every fake anybody writes. Chunk boundaries do
 * not respect event boundaries, keep-alive comments appear under load, engines add fields between
 * releases, and each of those failures shows up as a wrong NUMBER rather than as an error.
 */
import { describe, expect, it } from 'vitest';

import { RiyaLocalBenchmarkError } from '../contracts/errors.js';
import { projectRiyaLocalEngineChunk } from '../internal/engine-firewall.js';
import { projectRiyaLocalEngineModelIds } from '../internal/engine-firewall.js';
import { RiyaLocalSseDecoder } from '../internal/stream-decoder.js';

describe('the decoder is fed bytes, not events', () => {
  it('reassembles an event split across three chunks', () => {
    const decoder = new RiyaLocalSseDecoder();
    expect(decoder.push('data: {"a"')).toStrictEqual([]);
    expect(decoder.push(':1}')).toStrictEqual([]);
    expect(decoder.push('\n\n')).toStrictEqual(['{"a":1}']);
  });

  it('emits several events arriving in one chunk, in order', () => {
    const decoder = new RiyaLocalSseDecoder();
    expect(decoder.push('data: {"a":1}\n\ndata: {"a":2}\n\n')).toStrictEqual([
      '{"a":1}',
      '{"a":2}',
    ]);
  });

  it('tolerates CRLF line endings', () => {
    const decoder = new RiyaLocalSseDecoder();
    expect(decoder.push('data: {"a":1}\r\n\r\n')).toStrictEqual(['{"a":1}']);
  });

  it('drops keep-alive comments and unknown fields', () => {
    // A keep-alive surfacing as an event would make "the first thing that arrived" ambiguous at exactly
    // the moment time-to-first-token is sampled.
    const decoder = new RiyaLocalSseDecoder();
    expect(decoder.push(': ping\n\n')).toStrictEqual([]);
    expect(decoder.push('event: message\nid: 7\ndata: {"a":1}\n\n')).toStrictEqual(['{"a":1}']);
  });

  it('flushes a final event that arrived without its trailing blank line', () => {
    const decoder = new RiyaLocalSseDecoder();
    expect(decoder.push('data: [DONE]')).toStrictEqual([]);
    expect(decoder.finish()).toStrictEqual(['[DONE]']);
  });

  it('refuses an unbounded line rather than growing until the process dies', () => {
    const decoder = new RiyaLocalSseDecoder();
    expect(() => decoder.push('x'.repeat(1_048_577))).toThrow(RiyaLocalBenchmarkError);
  });
});

describe('a chunk is projected, and the raw object never survives', () => {
  it('keeps only the four things that have meaning', () => {
    const projected = projectRiyaLocalEngineChunk(
      JSON.stringify({
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        created: 1,
        // Fields real engines add and future ones will add more of. Dropped, not refused: a benchmark
        // adapter that broke on a routine engine upgrade would prove nothing and cost a run.
        system_fingerprint: 'fp_1',
        service_tier: 'default',
        timings: { predicted_ms: 12 },
        model: 'vendor.alpha/base.alpha-14',
        choices: [{ index: 0, delta: { role: 'assistant', content: 'alpha' }, logprobs: null }],
        usage: { prompt_tokens: 11, completion_tokens: 2, total_tokens: 13 },
      }),
    );
    expect(projected).toStrictEqual({
      model: 'vendor.alpha/base.alpha-14',
      contentDelta: 'alpha',
      finished: false,
      usage: { promptTokens: 11, completionTokens: 2 },
    });
    // The exact assertion that matters: nothing unknown crossed. `logprobs`, `system_fingerprint` and
    // `timings` are not merely unused -- they are absent from the value the adapter holds.
    expect(Object.keys(projected).sort()).toStrictEqual([
      'contentDelta',
      'finished',
      'model',
      'usage',
    ]);
  });

  it('treats a role-only, empty or null delta as no output', () => {
    for (const delta of [{ role: 'assistant' }, { content: '' }, { content: null }, {}]) {
      const projected = projectRiyaLocalEngineChunk(JSON.stringify({ choices: [{ delta }] }));
      expect(projected.contentDelta, JSON.stringify(delta)).toBeUndefined();
    }
  });

  it('reads only the FIRST choice', () => {
    // This adapter never requests `n > 1`. Crediting a second choice would count output the benchmark
    // did not ask for, and inflate a throughput figure.
    const projected = projectRiyaLocalEngineChunk(
      JSON.stringify({
        choices: [{ delta: { content: 'alpha' } }, { delta: { content: 'beta' } }],
      }),
    );
    expect(projected.contentDelta).toBe('alpha');
  });

  it('refuses a non-numeric, negative or fractional usage count rather than coercing it', () => {
    for (const usage of [
      { completion_tokens: '2' },
      { completion_tokens: -1 },
      { completion_tokens: 2.5 },
      { completion_tokens: null },
    ]) {
      const projected = projectRiyaLocalEngineChunk(JSON.stringify({ usage }));
      expect(projected.usage?.completionTokens, JSON.stringify(usage)).toBeUndefined();
    }
  });

  it('refuses a payload that is not an object', () => {
    for (const payload of ['<html>gateway</html>', '[]', 'null', '"text"', '']) {
      expect(() => projectRiyaLocalEngineChunk(payload), payload).toThrow(RiyaLocalBenchmarkError);
    }
  });

  it('reads own data properties, so a __proto__ key cannot pollute anything', () => {
    const projected = projectRiyaLocalEngineChunk('{"__proto__":{"polluted":true},"model":"m"}');
    expect(projected.model).toBe('m');
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});

describe('a model listing is projected the same way', () => {
  it('reads the ids and nothing else', () => {
    expect(
      projectRiyaLocalEngineModelIds(
        JSON.stringify({
          object: 'list',
          data: [
            { id: 'a', owned_by: 'someone', root: '/models/a', permission: [{ id: 'p' }] },
            { id: 'b' },
          ],
        }),
      ),
    ).toStrictEqual(['a', 'b']);
  });

  it('refuses a body that is not a listing, and one that is absurdly large', () => {
    expect(() => projectRiyaLocalEngineModelIds('not json')).toThrow(RiyaLocalBenchmarkError);
    expect(() => projectRiyaLocalEngineModelIds('{"data":{}}')).toThrow(RiyaLocalBenchmarkError);
    expect(() =>
      projectRiyaLocalEngineModelIds(
        JSON.stringify({ data: Array.from({ length: 4_097 }, () => ({ id: 'x' })) }),
      ),
    ).toThrow(RiyaLocalBenchmarkError);
  });
});
