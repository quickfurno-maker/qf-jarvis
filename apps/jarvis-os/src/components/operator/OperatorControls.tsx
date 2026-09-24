'use client';

import { useEffect, useState } from 'react';

import {
  parseOperatorCommand,
  type OperatorAction,
  type OperatorCommand,
} from '@qf-jarvis/operator-api-contract';

import { useOperatorCommands } from './OperatorCommandProvider';

type ResultTone = 'idle' | 'busy' | 'success' | 'warning' | 'error';

function resultClass(tone: ResultTone): string {
  if (tone === 'success') return 'text-[var(--color-healthy)]';
  if (tone === 'warning') return 'text-[var(--color-warning)]';
  if (tone === 'error') return 'text-[var(--color-critical)]';
  return 'text-[var(--color-ink-faint)]';
}

function CommandButton({
  action,
  label,
  confirmLabel,
  build,
  confirm = false,
  disabled = false,
}: {
  readonly action: OperatorAction;
  readonly label: string;
  readonly confirmLabel?: string;
  readonly build: (commandId: string) => OperatorCommand;
  readonly confirm?: boolean;
  readonly disabled?: boolean;
}) {
  const { capabilityState, execute, loading } = useOperatorCommands();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resultText, setResultText] = useState('');
  const [tone, setTone] = useState<ResultTone>('idle');
  const capability = capabilityState(action);
  const available = capability === 'AVAILABLE' && !loading && !disabled && !busy;

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => { setArmed(false); }, 6_000);
    return () => { clearTimeout(timer); };
  }, [armed]);

  async function run(): Promise<void> {
    if (!available) return;
    if (confirm && !armed) {
      setArmed(true);
      setTone('warning');
      setResultText('Confirm within 6 seconds.');
      return;
    }
    setArmed(false);
    setBusy(true);
    setTone('busy');
    setResultText('Submitting to authority…');
    try {
      const commandId = crypto.randomUUID();
      const command = parseOperatorCommand(build(commandId));
      const result = await execute(command);
      if (result.status === 'APPLIED_BY_AUTHORITY') {
        setTone('success');
        setResultText('Applied by QuickFurno Core.');
      } else if (result.status === 'SUBMITTED_TO_AUTHORITY') {
        setTone('success');
        setResultText('Submitted to authority.');
      } else if (result.status === 'CONFLICT') {
        setTone('warning');
        setResultText('State changed. Refresh and review.');
      } else if (result.status === 'REFUSED') {
        setTone('error');
        setResultText('Refused by authority.');
      } else {
        setTone('error');
        setResultText('Command bridge unavailable.');
      }
    } catch {
      setTone('error');
      setResultText('Command failed closed.');
    } finally {
      setBusy(false);
    }
  }

  const disabledReason =
    capability === 'LOCKED'
      ? 'Locked by governance'
      : capability !== 'AVAILABLE'
        ? 'Authority bridge not connected'
        : disabled
          ? 'Action is not valid for this state'
          : undefined;

  const visualClass = armed
    ? 'border-[var(--color-warning)]/60 bg-[var(--color-warning)]/12 text-[var(--color-warning)]'
    : available
      ? 'border-[var(--color-accent)]/35 bg-[var(--color-accent)]/8 text-[var(--color-accent-bright)] hover:border-[var(--color-accent)]/70 hover:bg-[var(--color-accent)]/14'
      : 'cursor-not-allowed border-[var(--color-line)] text-[var(--color-ink-faint)] opacity-65';

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={!available}
        title={disabledReason}
        onClick={() => void run()}
        className={'rounded-[var(--radius-control)] border px-2.5 py-1.5 text-[11px] font-semibold transition-all ' + visualClass}
      >
        {busy ? 'Working…' : armed ? (confirmLabel ?? 'Confirm ' + label) : label}
      </button>
      {resultText ? (
        <span className={'max-w-[22ch] text-[9.5px] leading-tight ' + resultClass(tone)}>
          {resultText}
        </span>
      ) : null}
    </span>
  );
}

export function ApprovalDecisionControls({
  approvalId,
  state,
}: {
  readonly approvalId: string;
  readonly state: 'awaiting-core' | 'awaiting-operator' | 'answered';
}) {
  const enabled = state === 'awaiting-operator';
  const build = (decision: 'APPROVE' | 'REJECT') => (commandId: string) => ({
    protocol: 'qfj.operator.command.v1' as const,
    commandId,
    issuedAt: new Date().toISOString(),
    idempotencyKey: 'web:' + commandId,
    clientPlatform: 'WEB' as const,
    action: 'APPROVAL_DECIDE' as const,
    payload: { approvalId, decision },
  });

  return (
    <span className="flex items-start gap-1.5">
      <CommandButton
        action="APPROVAL_DECIDE"
        label="Approve"
        confirmLabel="Confirm approve"
        build={build('APPROVE')}
        confirm
        disabled={!enabled}
      />
      <CommandButton
        action="APPROVAL_DECIDE"
        label="Reject"
        confirmLabel="Confirm reject"
        build={build('REJECT')}
        confirm
        disabled={!enabled}
      />
    </span>
  );
}

export function ConversationCommandControls({
  conversationId,
  revision,
  humanTakeover,
  aiPaused,
}: {
  readonly conversationId: string;
  readonly revision: number;
  readonly humanTakeover: boolean;
  readonly aiPaused: boolean;
}) {
  const build = (
    action: 'CONVERSATION_TAKEOVER' | 'CONVERSATION_RESUME_AI' | 'CONVERSATION_PAUSE_AI',
  ) => (commandId: string) => ({
    protocol: 'qfj.operator.command.v1' as const,
    commandId,
    issuedAt: new Date().toISOString(),
    idempotencyKey: 'web:' + commandId,
    clientPlatform: 'WEB' as const,
    action,
    payload: { conversationId, expectedRevision: revision },
  });

  if (humanTakeover || aiPaused) {
    return (
      <CommandButton
        action="CONVERSATION_RESUME_AI"
        label="Resume AI"
        build={build('CONVERSATION_RESUME_AI')}
      />
    );
  }

  return (
    <span className="flex items-start gap-1.5">
      <CommandButton
        action="CONVERSATION_TAKEOVER"
        label="Take over"
        build={build('CONVERSATION_TAKEOVER')}
      />
      <CommandButton
        action="CONVERSATION_PAUSE_AI"
        label="Pause AI"
        build={build('CONVERSATION_PAUSE_AI')}
      />
    </span>
  );
}
