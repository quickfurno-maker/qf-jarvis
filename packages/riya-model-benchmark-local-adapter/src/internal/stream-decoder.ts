/**
 * Server-sent-event framing for a streamed completion (AS4-PREP-A).
 *
 * ### Chunk boundaries mean nothing, and that is the whole reason this exists
 *
 * A transport hands back decoded text in whatever sizes the socket produced. One event can arrive in
 * three chunks, three events can arrive in one, and a JSON object can be split mid-string. The naive
 * `chunk.split('\n')` parser works on every fake and fails on a real engine under load -- and it fails
 * as a MISSED first token, which is a time-to-first-token measurement that is silently wrong rather
 * than a crash somebody notices.
 *
 * So the decoder buffers, emits only complete events, and is fed byte-boundary-agnostic text.
 *
 * ### It is bounded
 *
 * A local engine is a process on the same machine, not an adversary -- but it is a process that can
 * malfunction, and an unbounded buffer on a stream that never emits a newline is an out-of-memory in
 * the middle of a benchmark. A line longer than the cap is a protocol failure, which invalidates the
 * suite honestly instead of taking the process down with it.
 */
import { RiyaLocalBenchmarkError } from '../contracts/errors.js';

/** One megabyte of un-terminated line is already far past anything a completion stream emits. */
const MAX_BUFFERED_CHARACTERS = 1_048_576;

/**
 * Incremental decoder. `push` returns the `data:` payloads that completed in this chunk.
 *
 * Comment lines (`:` keep-alives) and every non-`data` field are dropped: they carry no output and no
 * usage, and a decoder that surfaced them would make "the first thing that arrived" ambiguous at
 * exactly the moment TTFT is sampled.
 */
export class RiyaLocalSseDecoder {
  private buffer = '';
  private readonly pending: string[] = [];

  public push(chunk: string): readonly string[] {
    this.buffer += chunk;
    if (this.buffer.length > MAX_BUFFERED_CHARACTERS) {
      throw new RiyaLocalBenchmarkError('ENGINE_PROTOCOL_INVALID');
    }
    const payloads: string[] = [];
    for (;;) {
      const breakIndex = this.buffer.indexOf('\n');
      if (breakIndex < 0) {
        break;
      }
      const rawLine = this.buffer.slice(0, breakIndex);
      this.buffer = this.buffer.slice(breakIndex + 1);
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      if (line === '') {
        // Blank line terminates one event. An event with no data field emits nothing.
        if (this.pending.length > 0) {
          payloads.push(this.pending.join('\n'));
          this.pending.length = 0;
        }
        continue;
      }
      if (line.startsWith(':')) {
        continue;
      }
      if (line.startsWith('data:')) {
        // One optional space after the colon, per the event-stream grammar.
        const value = line.slice(5);
        this.pending.push(value.startsWith(' ') ? value.slice(1) : value);
      }
      // Every other field name is deliberately ignored.
    }
    return payloads;
  }

  /**
   * Flush an event the stream ended without a blank line after.
   *
   * Real engines do terminate properly; this exists so a final `[DONE]` that arrives without its
   * trailing newline is still seen, rather than turning a healthy request into a protocol failure.
   */
  public finish(): readonly string[] {
    const tail = this.buffer;
    this.buffer = '';
    if (tail.startsWith('data:')) {
      const value = tail.slice(5);
      this.pending.push(value.startsWith(' ') ? value.slice(1) : value);
    }
    if (this.pending.length === 0) {
      return [];
    }
    const payload = this.pending.join('\n');
    this.pending.length = 0;
    return [payload];
  }
}
