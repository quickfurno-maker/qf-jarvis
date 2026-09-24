import { z } from 'zod';

import {
  OPERATOR_COMMAND_PROTOCOL,
  operatorCommandResultSchema,
  operatorCommandSchema,
  type OperatorCommand,
  type OperatorCommandResult,
} from '@qf-jarvis/operator-api-contract';

export const QUICKFURNO_OPERATOR_COMMAND_PATH = '/api/internal/jarvis/operator-command' as const;
export const QUICKFURNO_OPERATOR_COMMAND_SIGNING_DOMAIN =
  'qfj.jarvis-os.operator-command.http.sig.v1' as const;
export const QUICKFURNO_OPERATOR_COMMAND_CALLER = 'qf-jarvis-os' as const;
export const QUICKFURNO_OPERATOR_COMMAND_AUDIENCE = 'quickfurno-core' as const;
export const QUICKFURNO_OPERATOR_ID_HEADER = 'x-qfj-operator-id' as const;

const QUICKFURNO_ACTIONS = new Set([
  'APPROVAL_DECIDE',
  'CONVERSATION_TAKEOVER',
  'CONVERSATION_RESUME_AI',
  'CONVERSATION_PAUSE_AI',
]);

export const quickFurnoOperatorCommandSchema = operatorCommandSchema.refine(
  (value) => QUICKFURNO_ACTIONS.has(value.action),
  'action is not owned by QuickFurno Core',
);

export const quickFurnoOperatorCommandResultSchema = operatorCommandResultSchema;

export type QuickFurnoOperatorCommand = OperatorCommand & {
  readonly action:
    | 'APPROVAL_DECIDE'
    | 'CONVERSATION_TAKEOVER'
    | 'CONVERSATION_RESUME_AI'
    | 'CONVERSATION_PAUSE_AI';
};
export type QuickFurnoOperatorCommandResult = OperatorCommandResult;

export function parseQuickFurnoOperatorCommand(value: unknown): QuickFurnoOperatorCommand {
  const parsed = quickFurnoOperatorCommandSchema.parse(value);
  if (parsed.protocol !== OPERATOR_COMMAND_PROTOCOL) {
    throw new z.ZodError([]);
  }
  return parsed as QuickFurnoOperatorCommand;
}

export function parseQuickFurnoOperatorCommandResult(value: unknown): QuickFurnoOperatorCommandResult {
  return quickFurnoOperatorCommandResultSchema.parse(value);
}
