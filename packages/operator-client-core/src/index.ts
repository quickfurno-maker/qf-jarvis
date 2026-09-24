import {
  parseControlPlaneSnapshotV2,
  type ControlPlaneSnapshotV2,
} from '@qf-jarvis/control-plane-read-contract';
import {
  parseOperatorBootstrap,
  parseOperatorCommand,
  parseOperatorCommandResult,
  type OperatorBootstrap,
  type OperatorClientPlatform,
  type OperatorCommand,
  type OperatorCommandResult,
} from '@qf-jarvis/operator-api-contract';

export interface OperatorTransportRequest {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface OperatorTransportResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface OperatorTransport {
  request(input: OperatorTransportRequest): Promise<OperatorTransportResponse>;
}

export class OperatorClientError extends Error {
  constructor(
    readonly code:
      | 'UNAUTHENTICATED'
      | 'TRANSPORT_FAILURE'
      | 'INVALID_RESPONSE'
      | 'PLATFORM_MISMATCH'
      | 'COMMAND_REFUSED',
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'OperatorClientError';
  }
}

function requireSuccess(response: OperatorTransportResponse): unknown {
  if (response.status === 401) {
    throw new OperatorClientError('UNAUTHENTICATED', 'Operator session is not authenticated.', 401);
  }
  if (response.status < 200 || response.status >= 300) {
    throw new OperatorClientError(
      'TRANSPORT_FAILURE',
      'Operator API request failed.',
      response.status,
    );
  }
  return response.body;
}

export function createOperatorClient(args: {
  readonly platform: OperatorClientPlatform;
  readonly transport: OperatorTransport;
  readonly commandHeaders?: () => Readonly<Record<string, string>>;
}) {
  return Object.freeze({
    async bootstrap(): Promise<OperatorBootstrap> {
      const response = await args.transport.request({
        method: 'GET',
        path: '/api/operator/v1/bootstrap',
      });
      try {
        return parseOperatorBootstrap(requireSuccess(response));
      } catch (error) {
        if (error instanceof OperatorClientError) throw error;
        throw new OperatorClientError('INVALID_RESPONSE', 'Operator bootstrap was invalid.');
      }
    },

    async snapshot(): Promise<ControlPlaneSnapshotV2> {
      const response = await args.transport.request({
        method: 'GET',
        path: '/api/operator/v1/snapshot',
      });
      try {
        return parseControlPlaneSnapshotV2(requireSuccess(response));
      } catch (error) {
        if (error instanceof OperatorClientError) throw error;
        throw new OperatorClientError('INVALID_RESPONSE', 'Operator snapshot was invalid.');
      }
    },

    async command(command: OperatorCommand): Promise<OperatorCommandResult> {
      const parsed = parseOperatorCommand(command);
      if (parsed.clientPlatform !== args.platform) {
        throw new OperatorClientError(
          'PLATFORM_MISMATCH',
          'Command client platform does not match this client.',
        );
      }
      const headers = args.commandHeaders?.();
      const response = await args.transport.request({
        method: 'POST',
        path: '/api/operator/v1/commands',
        body: parsed,
        ...(headers === undefined ? {} : { headers }),
      });
      let result: OperatorCommandResult;
      try {
        result = parseOperatorCommandResult(response.body);
      } catch {
        if (response.status === 401) {
          throw new OperatorClientError('UNAUTHENTICATED', 'Operator session is not authenticated.', 401);
        }
        throw new OperatorClientError('INVALID_RESPONSE', 'Operator command result was invalid.', response.status);
      }
      // Command results are authoritative protocol outcomes even when HTTP carries 403/409/503.
      // Return the parsed outcome so every client renders REFUSED, CONFLICT and UNAVAILABLE
      // identically instead of turning them into transport exceptions.
      return result;
    },
  });
}

export type OperatorClient = ReturnType<typeof createOperatorClient>;
