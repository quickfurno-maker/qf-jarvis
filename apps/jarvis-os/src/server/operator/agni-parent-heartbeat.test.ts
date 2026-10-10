import { describe, expect, it } from 'vitest';
import {
  AGNI_PARENT_HEARTBEAT_REQUEST_PROTOCOL,
  parseAgniParentHeartbeat,
  parseAgniOwnerSnapshot,
} from './agni-owner-snapshot.js';

const challenge = '0a'.repeat(16);
const make = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8');
describe('signed M2M Jarvis parent heartbeat request boundary', () => {
  it('accepts only tightly bounded versioned request without weakening snapshot', () => {
    const raw = make({ protocol: AGNI_PARENT_HEARTBEAT_REQUEST_PROTOCOL, challenge });
    expect(parseAgniParentHeartbeat(raw)).toEqual(challenge);
    expect(parseAgniOwnerSnapshot(raw)).toBe(false);
  });
  it('rejects request injection, missing nonce, future versions and malformed data', () => {
    const good = { protocol: AGNI_PARENT_HEARTBEAT_REQUEST_PROTOCOL, challenge };
    for (const bad of [
      {},
      { ...good, challenge: 'short' },
      { ...good, challenge: 'A'.repeat(32) },
      { ...good, protocol: 'qfj.agni.parent-heartbeat.request.v2' },
      { ...good, command: 'deploy' },
      { ...good, level: 'L3' },
    ])
      expect(parseAgniParentHeartbeat(make(bad))).toBeNull();
    expect(parseAgniParentHeartbeat(Buffer.from('{invalid'))).toBeNull();
    expect(parseAgniParentHeartbeat(Buffer.alloc(4100))).toBeNull();
  });
});
