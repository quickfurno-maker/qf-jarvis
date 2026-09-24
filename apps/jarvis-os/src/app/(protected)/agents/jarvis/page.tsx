import { notFound } from 'next/navigation';

import { AgentOverview } from '@/components/agents/AgentOverview';
import { controlPlane } from '@/lib/control-plane';
import { agentOperationalMetrics } from '@/lib/control-plane/agent-live';

export default async function JarvisAgentPage() {
  const plane = await controlPlane();
  const agent = plane.agent('jarvis');
  if (agent === undefined) {
    notFound();
  }
  return <AgentOverview agent={agent} metricsSection={agentOperationalMetrics(plane, 'jarvis')} />;
}
