import { notFound } from 'next/navigation';

import { AgentOverview } from '@/components/agents/AgentOverview';
import { controlPlane } from '@/lib/control-plane';

export default function RiyaAgentPage() {
  const agent = controlPlane().agent('riya');
  if (agent === undefined) {
    notFound();
  }
  return <AgentOverview agent={agent} />;
}
