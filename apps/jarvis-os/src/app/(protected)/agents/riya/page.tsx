import { notFound } from 'next/navigation';

import { AgentOverview } from '@/components/agents/AgentOverview';
import { controlPlane } from '@/lib/control-plane';

export default async function RiyaAgentPage() {
  const agent = (await controlPlane()).agent('riya');
  if (agent === undefined) {
    notFound();
  }
  return <AgentOverview agent={agent} />;
}
