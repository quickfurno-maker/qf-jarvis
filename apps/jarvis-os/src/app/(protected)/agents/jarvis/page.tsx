import { notFound } from 'next/navigation';

import { AgentOverview } from '@/components/agents/AgentOverview';
import { controlPlane } from '@/lib/control-plane';

export default async function JarvisAgentPage() {
  const agent = (await controlPlane()).agent('jarvis');
  if (agent === undefined) {
    notFound();
  }
  return <AgentOverview agent={agent} />;
}
