import { notFound } from 'next/navigation';

import { AgentOverview } from '@/components/agents/AgentOverview';
import { controlPlane } from '@/lib/control-plane';

export default function JarvisAgentPage() {
  const agent = controlPlane().agent('jarvis');
  if (agent === undefined) {
    notFound();
  }
  return <AgentOverview agent={agent} />;
}
