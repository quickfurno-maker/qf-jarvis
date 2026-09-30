'use client';

import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import {
  RIYA_WHATSAPP_CLIENT_FLOW_V1,
  type AgentFlowEdgeDefinition,
  type AgentFlowNodeDefinition,
} from '@qf-jarvis/agent-flow-registry';
import { useMemo, useState } from 'react';

interface FlowNodeData extends Record<string, unknown> {
  readonly definition: AgentFlowNodeDefinition;
}

const POSITIONS: Readonly<Record<string, { readonly x: number; readonly y: number }>> = {
  'riya.trigger.whatsapp-inbound': { x: 0, y: 260 },
  'riya.queue.claim-turn': { x: 260, y: 260 },
  'riya.context.turn-material': { x: 540, y: 120 },
  'riya.context.conversation': { x: 540, y: 420 },
  'riya.memory.client-journey': { x: 830, y: 0 },
  'riya.memory.lifetime': { x: 830, y: 135 },
  'riya.memory.vendor-journey': { x: 830, y: 270 },
  'riya.context.core-availability': { x: 830, y: 405 },
  'riya.detect.vendor-feedback': { x: 1120, y: 100 },
  'riya.action.record-vendor-feedback': { x: 1400, y: 10 },
  'riya.context.refresh-after-feedback': { x: 1680, y: 10 },
  'riya.intelligence.client-os': { x: 1400, y: 270 },
  'riya.condition.request-match': { x: 1680, y: 270 },
  'riya.action.request-match': { x: 1960, y: 180 },
  'riya.context.refresh-after-match': { x: 2240, y: 180 },
  'riya.agent.specialist-runtime': { x: 2520, y: 310 },
  'riya.action.write-reply': { x: 2820, y: 310 },
  'riya.queue.complete': { x: 3100, y: 310 },
};

const KIND_STYLES: Readonly<Record<AgentFlowNodeDefinition['kind'], string>> = {
  TRIGGER: 'border-[var(--color-cyan)]/55',
  CONTEXT: 'border-[var(--color-info)]/55',
  MEMORY: 'border-[var(--color-violet)]/55',
  INTELLIGENCE: 'border-[var(--color-accent-bright)]/60',
  ORCHESTRATION: 'border-[var(--color-warning)]/55',
  CAPABILITY: 'border-[var(--color-healthy)]/55',
  CHANNEL: 'border-[var(--color-cyan)]/55',
  HUMAN: 'border-[var(--color-warning)]/55',
  SYSTEM: 'border-[var(--color-line-strong)]',
};

const EDGE_STYLE: Readonly<
  Record<AgentFlowEdgeDefinition['kind'], { stroke: string; strokeDasharray?: string }>
> = {
  CONTROL: { stroke: '#64708a' },
  DATA: { stroke: '#4d8dff', strokeDasharray: '5 5' },
  COMMAND: { stroke: '#2fd39b' },
  RESULT: { stroke: '#38d1e0' },
  EVENT: { stroke: '#9d7bff', strokeDasharray: '2 5' },
};

function FlowNode({ data, selected }: NodeProps<Node<FlowNodeData>>) {
  const node = data.definition;
  return (
    <div
      className={[
        'w-[220px] rounded-[10px] border bg-[var(--color-base-900)] px-3.5 py-3 shadow-[0_12px_28px_rgba(0,0,0,0.22)]',
        KIND_STYLES[node.kind],
        selected ? 'ring-1 ring-[var(--color-accent-bright)]' : '',
      ].join(' ')}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-0 !bg-[var(--color-line-strong)]"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] font-semibold tracking-[0.09em] text-[var(--color-ink-faint)] uppercase">
          {node.kind}
        </span>
        <span className="rounded-full border border-[var(--color-line)] px-1.5 py-0.5 text-[8.5px] font-semibold text-[var(--color-ink-muted)]">
          {node.executionRole}
        </span>
      </div>
      <p className="mt-2 text-[12px] font-semibold leading-snug text-[var(--color-ink)]">
        {node.label}
      </p>
      <p className="mt-1 line-clamp-2 text-[9.5px] leading-relaxed text-[var(--color-ink-faint)]">
        {node.description}
      </p>
      <div className="mt-2.5 flex flex-wrap gap-1">
        <span className="rounded-full bg-[var(--color-base-800)] px-1.5 py-0.5 text-[8px] text-[var(--color-ink-muted)]">
          {node.authority}
        </span>
        {node.codeLocked ? (
          <span className="rounded-full bg-[var(--color-base-800)] px-1.5 py-0.5 text-[8px] text-[var(--color-healthy)]">
            CODE LOCKED
          </span>
        ) : null}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-0 !bg-[var(--color-line-strong)]"
      />
    </div>
  );
}

const NODE_TYPES = { agentFlow: FlowNode } as const;

function edgeFor(definition: AgentFlowEdgeDefinition): Edge {
  return {
    id: definition.edgeId,
    source: definition.sourceNodeId,
    target: definition.targetNodeId,
    type: 'smoothstep',
    label: definition.label,
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
    style: {
      strokeWidth: definition.kind === 'COMMAND' ? 1.8 : 1.25,
      ...EDGE_STYLE[definition.kind],
    },
    labelStyle: {
      fill: '#98a3b8',
      fontSize: 9,
      fontWeight: 600,
    },
    labelBgStyle: {
      fill: '#0a0d14',
      fillOpacity: 0.92,
    },
  };
}

export function AgentFlowCanvas() {
  const flow = RIYA_WHATSAPP_CLIENT_FLOW_V1;
  const [selectedId, setSelectedId] = useState('riya.agent.specialist-runtime');

  const nodes = useMemo<Node<FlowNodeData>[]>(
    () =>
      flow.nodes.map((definition) => ({
        id: definition.nodeId,
        type: 'agentFlow',
        position: POSITIONS[definition.nodeId] ?? { x: 0, y: 0 },
        data: { definition },
        draggable: false,
        connectable: false,
        selectable: true,
      })),
    [flow.nodes],
  );
  const edges = useMemo<Edge[]>(() => flow.edges.map(edgeFor), [flow.edges]);
  const selected = flow.nodes.find((node) => node.nodeId === selectedId) ?? flow.nodes[0];

  const governedActions = flow.nodes.filter(
    (node) => node.effect === 'GOVERNED_ACTION' || node.effect === 'CHANNEL_REQUEST',
  ).length;
  const projections = flow.nodes.filter((node) => node.executionRole === 'PROJECTION').length;

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Flow', flow.label],
          ['Nodes', String(flow.nodes.length)],
          ['Governed actions', String(governedActions)],
          ['Read projections', String(projections)],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-base-900)] px-3.5 py-3"
          >
            <p className="text-[9.5px] font-semibold tracking-[0.08em] text-[var(--color-ink-faint)] uppercase">
              {label}
            </p>
            <p className="mt-1.5 text-[13px] font-semibold text-[var(--color-ink)]">{value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-base-900)] px-3.5 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-[6px] border border-[var(--color-accent-dim)] bg-[var(--color-base-800)] px-2.5 py-1 text-[10px] font-semibold text-[var(--color-accent-bright)]">
            RIYA
          </span>
          <span className="rounded-[6px] border border-[var(--color-line)] px-2.5 py-1 text-[10px] text-[var(--color-ink-faint)]">
            ANISHA · Phase 3
          </span>
          <span className="rounded-[6px] border border-[var(--color-line)] px-2.5 py-1 text-[10px] text-[var(--color-ink-faint)]">
            AAROHI · Phase 3
          </span>
        </div>
        <span className="text-[9.5px] font-semibold tracking-[0.08em] text-[var(--color-warning)] uppercase">
          Read-only architecture mirror
        </span>
      </div>

      <div className="grid min-h-[680px] gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
        <div className="overflow-hidden rounded-[var(--radius-panel)] border border-[var(--color-line)] bg-[var(--color-base-950)]">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            fitView
            fitViewOptions={{ padding: 0.16, minZoom: 0.32, maxZoom: 0.85 }}
            minZoom={0.2}
            maxZoom={1.6}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            onNodeClick={(_, node) => {
              setSelectedId(node.id);
            }}
          >
            <MiniMap
              pannable
              zoomable
              nodeStrokeWidth={2}
              maskColor="rgba(6,8,13,0.72)"
              style={{ background: '#0a0d14', border: '1px solid #1e2534' }}
            />
            <Controls
              showInteractive={false}
              style={{ background: '#0a0d14', borderColor: '#1e2534' }}
            />
            <Background gap={24} size={1} color="#1e2534" />
          </ReactFlow>
        </div>

        <aside className="rounded-[var(--radius-panel)] border border-[var(--color-line)] bg-[var(--color-base-900)] p-4">
          {selected === undefined ? null : (
            <>
              <div className="flex items-start justify-between gap-3 border-b border-[var(--color-line)] pb-3">
                <div>
                  <p className="text-[9.5px] font-semibold tracking-[0.08em] text-[var(--color-ink-faint)] uppercase">
                    Selected node
                  </p>
                  <h2 className="mt-1 text-[15px] font-semibold text-[var(--color-ink)]">
                    {selected.label}
                  </h2>
                </div>
                <span className="rounded-full border border-[var(--color-line)] px-2 py-1 text-[8.5px] font-semibold text-[var(--color-ink-muted)]">
                  {selected.status}
                </span>
              </div>

              <dl className="mt-4 space-y-3 text-[11px]">
                {[
                  ['Node ID', selected.nodeId],
                  ['Owner', selected.actor],
                  ['Stage', selected.stage],
                  ['Kind', selected.kind],
                  ['Runtime role', selected.executionRole],
                  ['Authority', selected.authority],
                  ['Effect', selected.effect],
                  ['Version', 'v' + String(selected.nodeVersion)],
                ].map(([term, detail]) => (
                  <div key={term} className="grid grid-cols-[92px_minmax(0,1fr)] gap-3">
                    <dt className="text-[var(--color-ink-faint)]">{term}</dt>
                    <dd className="break-words font-medium text-[var(--color-ink-muted)]">
                      {detail}
                    </dd>
                  </div>
                ))}
              </dl>

              <div className="mt-4 border-t border-[var(--color-line)] pt-4">
                <p className="text-[9.5px] font-semibold tracking-[0.08em] text-[var(--color-ink-faint)] uppercase">
                  Implementation
                </p>
                <code className="mt-2 block break-all rounded-[6px] bg-[var(--color-base-850)] px-2.5 py-2 text-[10px] leading-relaxed text-[var(--color-cyan)]">
                  {selected.implementationRef}
                </code>
              </div>

              <div className="mt-4 border-t border-[var(--color-line)] pt-4">
                <p className="text-[9.5px] font-semibold tracking-[0.08em] text-[var(--color-ink-faint)] uppercase">
                  Canvas control
                </p>
                {selected.canvasEditable.length === 0 ? (
                  <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-ink-muted)]">
                    Locked in Phase 1. This node is visible but has no canvas-editable
                    configuration.
                  </p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {selected.canvasEditable.map((key) => (
                      <span
                        key={key}
                        className="rounded-full border border-[var(--color-line)] bg-[var(--color-base-850)] px-2 py-1 text-[9px] text-[var(--color-ink-muted)]"
                      >
                        {key}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-4 border-t border-[var(--color-line)] pt-4">
                <p className="text-[10.5px] leading-relaxed text-[var(--color-ink-muted)]">
                  {selected.description}
                </p>
                {selected.codeLocked ? (
                  <p className="mt-3 text-[10px] font-semibold text-[var(--color-healthy)]">
                    Capability implementation is code-locked.
                  </p>
                ) : null}
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
