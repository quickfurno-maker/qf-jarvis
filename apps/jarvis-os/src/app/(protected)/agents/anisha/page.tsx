import { notFound } from 'next/navigation';

import { AgentOverview } from '@/components/agents/AgentOverview';
import { Notice } from '@/components/primitives/Panel';
import { controlPlane } from '@/lib/control-plane';

/**
 * Anisha — REGISTERED-vendor relationship, support and success.
 *
 * The separation notice is repeated on both vendor agent pages on purpose. These two are the
 * pair most likely to be conflated by a future contributor, and the cost of that mistake is
 * an acquisition agent gaining access to existing-vendor relationships, or a care agent
 * gaining an outreach channel.
 */
export default function AnishaAgentPage() {
  const agent = controlPlane().agent('anisha');
  if (agent === undefined) {
    notFound();
  }
  return (
    <AgentOverview agent={agent}>
      <Notice tone="info" title="Anisha is not Aarohi">
        Anisha works with vendors QuickFurno Core has already registered — support, onboarding,
        success and retention. Acquiring vendors who are not yet registered belongs to Aarohi, on a
        separate surface with a separate capability. Neither agent performs the other&rsquo;s work.
      </Notice>
    </AgentOverview>
  );
}
