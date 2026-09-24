import { createHash, createPrivateKey, sign } from 'node:crypto';

import {
  QUICKFURNO_OPERATOR_COMMAND_AUDIENCE,
  QUICKFURNO_OPERATOR_COMMAND_CALLER,
  QUICKFURNO_OPERATOR_COMMAND_PATH,
  QUICKFURNO_OPERATOR_COMMAND_SIGNING_DOMAIN,
  QUICKFURNO_OPERATOR_ID_HEADER,
  parseQuickFurnoOperatorCommand,
  parseQuickFurnoOperatorCommandResult,
  type QuickFurnoOperatorCommandResult,
} from '@qf-jarvis/quickfurno-operator-command-contract';
import type { OperatorCommand } from '@qf-jarvis/operator-api-contract';

import { loadCoreCommandConfig } from '../auth/config/loader';

function bodyDigest(raw: Uint8Array): string {
  return createHash('sha256').update(raw).digest('base64url');
}

function signingInput(args: {
  readonly commandId: string;
  readonly issuedAt: string;
  readonly keyId: string;
  readonly operatorId: string;
  readonly digest: string;
}): string {
  return [
    QUICKFURNO_OPERATOR_COMMAND_SIGNING_DOMAIN,
    'POST',
    QUICKFURNO_OPERATOR_COMMAND_PATH,
    QUICKFURNO_OPERATOR_COMMAND_CALLER,
    QUICKFURNO_OPERATOR_COMMAND_AUDIENCE,
    args.operatorId,
    args.commandId,
    args.issuedAt,
    args.keyId,
    args.digest,
  ].join('\n');
}

export async function submitQuickFurnoOperatorCommand(
  command: OperatorCommand,
  operatorId: string,
  signal?: AbortSignal,
): Promise<QuickFurnoOperatorCommandResult> {
  const parsed = parseQuickFurnoOperatorCommand(command);
  const config = loadCoreCommandConfig();
  const body = new TextEncoder().encode(JSON.stringify(parsed));
  const key = createPrivateKey(config.privateKeyPem);
  if (key.type !== 'private' || key.asymmetricKeyType !== 'ed25519') {
    throw new TypeError('core-command-key-invalid');
  }
  const signature = sign(
    null,
    Buffer.from(
      signingInput({
        commandId: parsed.commandId,
        issuedAt: parsed.issuedAt,
        keyId: config.keyId,
        operatorId,
        digest: bodyDigest(body),
      }),
      'utf8',
    ),
    key,
  ).toString('base64url');

  // eslint-disable-next-line no-restricted-globals -- reviewed server-only QuickFurno command transport.
  const response = await fetch(new URL(QUICKFURNO_OPERATOR_COMMAND_PATH, config.baseUrl), {
    method: 'POST',
    ...(signal === undefined ? {} : { signal }),
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      'x-qfj-key-id': config.keyId,
      'x-qfj-signature': signature,
      [QUICKFURNO_OPERATOR_ID_HEADER]: operatorId,
    },
    body,
  });

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < 2 || bytes.byteLength > 16_384) {
    throw new TypeError('core-command-response-invalid');
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new TypeError('core-command-response-invalid');
  }
  const result = parseQuickFurnoOperatorCommandResult(value);
  if (result.commandId !== parsed.commandId) {
    throw new TypeError('core-command-correlation-invalid');
  }
  return result;
}
