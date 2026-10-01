import { AosBehaviourStudio } from '@/components/aos/AosBehaviourStudio';
import { AosDetectorCoverage } from '@/components/aos/AosDetectorCoverage';
import { AosGovernanceStack } from '@/components/aos/AosGovernanceStack';
import { AosIntelligenceCanvas } from '@/components/aos/AosIntelligenceCanvas';
import { AosOwnerAttention } from '@/components/aos/AosOwnerAttention';
import { Notice } from '@/components/primitives/Panel';
import { PageHeader } from '@/components/shell/PageHeader';
import { readAosOwnerAttentionObservationPathFromEnvironment } from '@/server/auth/config/loader';
import { readAosOwnerAttentionObservation } from '@/server/control-plane/sources/aos-owner-attention-source';

export default async function AosPage() {
  const attentionRead = await readAosOwnerAttentionObservation(
    readAosOwnerAttentionObservationPathFromEnvironment(),
  );
  return (
    <>
      <PageHeader
        breadcrumb={['Intelligence', 'AOS']}
        title="AOS Intelligence"
        purpose="QuickFurno marketplace sentry, case correlation, evidence minimization, governed recommendations and behaviour control. Core remains business authority; AOS is suggestion-only."
        status={
          <span className="rounded-full border border-[var(--color-line)] bg-[var(--color-base-850)] px-2.5 py-1 text-[9.5px] font-semibold tracking-[0.06em] text-[var(--color-warning)] uppercase">
            AOS v2 · Suggestion mode
          </span>
        }
      />

      <Notice tone="warning" title="No autonomous business effects">
        Initial lead exposure remains three vendors. Any 4th+ vendor path, client expansion, vendor
        reactivation or supply-acquisition recommendation stays governed and reviewable. AOS cannot
        mutate Core truth, approve itself or send an unrestricted message.
      </Notice>

      <div className="mt-5 space-y-5">
        <AosIntelligenceCanvas />
        <AosGovernanceStack />
        <AosOwnerAttention read={attentionRead} />
        <AosDetectorCoverage />
        <AosBehaviourStudio />
      </div>
    </>
  );
}
