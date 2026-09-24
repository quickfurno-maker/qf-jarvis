'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';

import {
  type OperatorAction,
  type OperatorBootstrap,
  type OperatorCommand,
  type OperatorCommandResult,
} from '@qf-jarvis/operator-api-contract';
import { createOperatorClient, type OperatorTransport } from '@qf-jarvis/operator-client-core';

interface OperatorCommandContextValue {
  readonly bootstrap: OperatorBootstrap | null;
  readonly loading: boolean;
  readonly capabilityState: (action: OperatorAction) => 'AVAILABLE' | 'LOCKED' | 'NOT_CONNECTED';
  readonly execute: (command: OperatorCommand) => Promise<OperatorCommandResult>;
}

const OperatorCommandContext = createContext<OperatorCommandContextValue | null>(null);

function browserTransport(): OperatorTransport {
  return Object.freeze({
    async request(input: Parameters<OperatorTransport['request']>[0]) {
      // eslint-disable-next-line no-restricted-globals -- same-origin browser transport to Jarvis OS only.
      const response = await fetch(input.path, {
        method: input.method,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          ...(input.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(input.headers ?? {}),
        },
        ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      });
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = {};
      }
      return { status: response.status, body };
    },
  });
}

export function OperatorCommandProvider({
  csrfToken,
  children,
}: {
  readonly csrfToken: string;
  readonly children: ReactNode;
}) {
  const router = useRouter();
  const [bootstrap, setBootstrap] = useState<OperatorBootstrap | null>(null);
  const [loading, setLoading] = useState(true);

  const client = useMemo(
    () =>
      createOperatorClient({
        platform: 'WEB',
        transport: browserTransport(),
        commandHeaders: () => ({ 'x-qfj-csrf': csrfToken }),
      }),
    [csrfToken],
  );

  useEffect(() => {
    void (async () => {
      try {
        setBootstrap(await client.bootstrap());
      } catch {
        // Fail closed: missing bootstrap keeps every command unavailable.
      } finally {
        setLoading(false);
      }
    })();
  }, [client]);

  const capabilityState = useCallback(
    (action: OperatorAction): 'AVAILABLE' | 'LOCKED' | 'NOT_CONNECTED' =>
      bootstrap?.capabilities.find((item) => item.action === action)?.state ?? 'NOT_CONNECTED',
    [bootstrap],
  );

  const execute = useCallback(
    async (command: OperatorCommand): Promise<OperatorCommandResult> => {
      const result = await client.command(command);
      if (result.status === 'APPLIED_BY_AUTHORITY' || result.status === 'SUBMITTED_TO_AUTHORITY') {
        router.refresh();
      }
      return result;
    },
    [client, router],
  );

  const value = useMemo(
    () => ({ bootstrap, loading, capabilityState, execute }),
    [bootstrap, loading, capabilityState, execute],
  );

  return (
    <OperatorCommandContext.Provider value={value}>{children}</OperatorCommandContext.Provider>
  );
}

export function useOperatorCommands(): OperatorCommandContextValue {
  const value = useContext(OperatorCommandContext);
  if (value === null) {
    throw new Error('OperatorCommandProvider is required.');
  }
  return value;
}
