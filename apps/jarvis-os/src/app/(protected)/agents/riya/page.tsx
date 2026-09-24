import { notFound } from 'next/navigation';

import { AgentOverview } from '@/components/agents/AgentOverview';
import { controlPlane } from '@/lib/control-plane';
import { agentOperationalMetrics } from '@/lib/control-plane/agent-live';

export default async function RiyaAgentPage() {
  const plane = await controlPlane();
  const agent = plane.agent('riya');
  if (agent === undefined) {
    notFound();
  }
  return <AgentOverview agent={agent} metricsSection={agentOperationalMetrics(plane, 'riya')} />;
}
