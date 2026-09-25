import { LiveVoiceConsole } from '@/components/voice/LiveVoiceConsole';
import { Panel } from '@/components/primitives/Panel';
import { PageHeader } from '@/components/shell/PageHeader';

export default function VoicePage() {
  return (
    <>
      <PageHeader
        breadcrumb={['Control', 'Voice']}
        title="Jarvis Voice"
        purpose="LiveKit-powered realtime operator voice. It reuses Jarvis Intelligence and the existing authority model; it is not outbound business calling."
      />

      <div className="space-y-5">
        <LiveVoiceConsole />

        <Panel
          title="Voice boundary"
          subtitle="Realtime operator interface, never a privileged execution path. Background always-listening remains a separate privacy phase."
        >
          <div className="grid gap-3 text-[11px] leading-relaxed text-[var(--color-ink-muted)] md:grid-cols-2">
            <p>
              <strong className="text-[var(--color-ink)]">Operator voice:</strong> ask about current
              system state, incidents, agents, approvals, models, execution and capabilities through
              the same authenticated read-only intelligence contract used by Jarvis OS.
            </p>
            <p>
              <strong className="text-[var(--color-ink)]">Business voice:</strong> customer/vendor
              calling remains a separate governed communication action. LiveKit operator voice does
              not grant SIP, telephony, communication authorization or provider-send capability.
            </p>
          </div>
        </Panel>
      </div>
    </>
  );
}
