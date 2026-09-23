import type { CoreRiyaIntakePort } from '@qf-jarvis/core-riya-intake';
import type { DatabasePool } from '@qf-jarvis/event-backbone';
import { describe, expect, it, vi } from 'vitest';

import { createJf6RiyaStructuredActionBoundary } from '../jf6-private-process/create-riya-structured-action-boundary.js';

function pool(): DatabasePool {
  return { query: vi.fn() } as unknown as DatabasePool;
}

function intakePort(): CoreRiyaIntakePort & {
  readonly readCurrent: ReturnType<typeof vi.fn>;
  readonly lookupSubmission: ReturnType<typeof vi.fn>;
  readonly submit: ReturnType<typeof vi.fn>;
} {
  return {
    readCurrent: vi.fn(),
    lookupSubmission: vi.fn(),
    submit: vi.fn(),
  };
}

const availability = {
  baseUrl: 'https://core.quickfurno.invalid/',
  keyId: 'qfj.test.key',
  privateKeyPem:
    '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIJrLjL95hGUNOpwAH8XqbtSPDfHycaFW9OdDYkzq/RGp\n-----END PRIVATE KEY-----',
  clock: () => '2026-09-23T12:00:00.000Z',
  requestId: () => 'availability.request.1',
  httpPost: vi.fn(),
};

describe('JF-6 Riya structured-action boundary', () => {
  it('composes all four structured capabilities without performing I/O', () => {
    const port = intakePort();
    const boundary = createJf6RiyaStructuredActionBoundary({
      pool: pool(),
      availability,
      coreIntakePort: port,
    });

    expect(Object.keys(boundary).sort()).toEqual([
      'advanceContact',
      'confirmSummary',
      'editSummary',
      'submitConfirmedIntake',
    ]);
    expect(port.readCurrent).not.toHaveBeenCalled();
    expect(port.lookupSubmission).not.toHaveBeenCalled();
    expect(port.submit).not.toHaveBeenCalled();
    expect(availability.httpPost).not.toHaveBeenCalled();
  });

  it('refuses construction without the complete Core intake authority', () => {
    const partial = {
      readCurrent: vi.fn(),
      lookupSubmission: vi.fn(),
    } as unknown as CoreRiyaIntakePort;

    expect(() =>
      createJf6RiyaStructuredActionBoundary({
        pool: pool(),
        availability,
        coreIntakePort: partial,
      }),
    ).toThrow('invalid-input');
  });

  it('does not expose the Core port or the durable store from the boundary', () => {
    const boundary = createJf6RiyaStructuredActionBoundary({
      pool: pool(),
      availability,
      coreIntakePort: intakePort(),
    });

    expect('coreIntakePort' in boundary).toBe(false);
    expect('continuityStore' in boundary).toBe(false);
    expect('availabilityReader' in boundary).toBe(false);
  });
});
