import { LiveVoiceConsole } from '@/components/voice/LiveVoiceConsole';
import { Panel } from '@/components/primitives/Panel';
import { PageHeader } from '@/components/shell/PageHeader';

export default function VoicePage() {
  return (
    <>
      <PageHeader
        breadcrumb={['Control', 'Voice']}
        title="Jarvis Voice"
        purpose="LiveKit-powered realtime audio transport for Jarvis. LiveKit carries voice; Jarvis intelligence remains outside the LiveKit layer."
      />

      <div className="space-y-5">
        <LiveVoiceConsole />

        <Panel
          title="Voice boundary"
          subtitle="Realtime operator interface, never a privileged execution path. Background always-listening remains a separate privacy phase."
        >
          <div className="grid gap-3 text-[11px] leading-relaxed text-[var(--color-ink-muted)] md:grid-cols-2">
            <p>
              <strong className="text-[var(--color-ink)]">Operator voice transport:</strong> LiveKit
              provides the authenticated realtime room, microphone transport and agent dispatch. No
              speech model or Jarvis reasoning runs inside LiveKit.
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
