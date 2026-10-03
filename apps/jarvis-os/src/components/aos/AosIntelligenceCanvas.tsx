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
  AOS_PIPELINE_EDGE_KINDS,
  AOS_PIPELINE_V1,
  type AosPipelineEdge,
  type AosPipelineEdgeKind,
  type AosPipelineNode,
} from '@qf-jarvis/aos-intelligence';
import { useMemo, useState } from 'react';

interface AosNodeData extends Record<string, unknown> {
  readonly definition: AosPipelineNode;
}

const OWNER_TONE: Readonly<Record<AosPipelineNode['owner'], string>> = {
  QUICKFURNO_CORE: 'border-[var(--color-healthy)]/60',
  AOS: 'border-[var(--color-accent-bright)]/60',
  JARVIS: 'border-[var(--color-violet)]/60',
  OWNER: 'border-[var(--color-warning)]/60',
  AUTOMATION: 'border-[var(--color-cyan)]/60',
  AGENTS: 'border-[var(--color-info)]/60',
};

const EDGE_STYLE: Readonly<
  Record<AosPipelineEdgeKind, { readonly stroke: string; readonly dash?: string }>
> = {
  EVENT: { stroke: '#64708a' },
  EVIDENCE: { stroke: '#4d8dff', dash: '5 5' },
  REASONING: { stroke: '#9d7bff', dash: '3 4' },
  RECOMMENDATION: { stroke: '#f2b84b' },
  AUTHORIZED_ACTION: { stroke: '#2fd39b' },
  OUTCOME: { stroke: '#38d1e0' },
  FEEDBACK: { stroke: '#8b98b3', dash: '2 5' },
};

function AosNodeCard({ data, selected }: NodeProps<Node<AosNodeData>>) {
  const node = data.definition;
  return (
    <div
      className={[
        'w-[220px] rounded-[10px] border bg-[var(--color-base-900)] px-3.5 py-3 shadow-[0_12px_28px_rgba(0,0,0,0.22)]',
        OWNER_TONE[node.owner],
        selected ? 'outline outline-1 outline-[var(--color-accent-bright)]' : '',
      ].join(' ')}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-0 !bg-[var(--color-line-strong)]"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[8.5px] font-semibold tracking-[0.08em] text-[var(--color-ink-faint)] uppercase">
          {node.group}
        </span>
        <span className="rounded-full border border-[var(--color-line)] px-1.5 py-0.5 text-[8px] font-semibold text-[var(--color-ink-muted)]">
          {node.status}
        </span>
      </div>
      <p className="mt-2 text-[12px] font-semibold leading-snug text-[var(--color-ink)]">
        {node.label}
      </p>
      <p className="mt-1 line-clamp-3 text-[9.5px] leading-relaxed text-[var(--color-ink-faint)]">
        {node.description}
      </p>
      <div className="mt-2.5 flex flex-wrap gap-1">
        <span className="rounded-full bg-[var(--color-base-800)] px-1.5 py-0.5 text-[8px] text-[var(--color-ink-muted)]">
          {node.owner}
        </span>
        <span className="rounded-full bg-[var(--color-base-800)] px-1.5 py-0.5 text-[8px] text-[var(--color-ink-muted)]">
          AUTH · {node.authority}
        </span>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-0 !bg-[var(--color-line-strong)]"
      />
    </div>
  );
}

const NODE_TYPES = { aos: AosNodeCard } as const;

function edgeFor(definition: AosPipelineEdge): Edge {
  const visual = EDGE_STYLE[definition.kind];
  return {
    id: definition.edgeId,
    source: definition.sourceNodeId,
    target: definition.targetNodeId,
    type: 'smoothstep',
    label: definition.label,
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
    style: {
      stroke: visual.stroke,
      strokeWidth: definition.kind === 'AUTHORIZED_ACTION' ? 1.8 : 1.25,
      ...(visual.dash === undefined ? {} : { strokeDasharray: visual.dash }),
    },
    labelStyle: { fill: '#98a3b8', fontSize: 9, fontWeight: 600 },
    labelBgStyle: { fill: '#0a0d14', fillOpacity: 0.92 },
  };
}

export function AosIntelligenceCanvas() {
  const [selectedId, setSelectedId] = useState('aos.case-engine');

  const nodes = useMemo<Node<AosNodeData>[]>(
    () =>
      AOS_PIPELINE_V1.nodes.map((definition) => ({
        id: definition.nodeId,
        type: 'aos',
        position: { x: definition.x, y: definition.y },
        data: { definition },
      })),
    [],
  );

  const edges = useMemo<Edge[]>(() => AOS_PIPELINE_V1.edges.map(edgeFor), []);

  const selected = AOS_PIPELINE_V1.nodes.find((node) => node.nodeId === selectedId);

  return (
    <div className="space-y-3">
      <div className="grid gap-2 xl:grid-cols-[1fr_1fr_1fr]">
        <div className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-base-900)] px-3.5 py-3">
          <p className="text-[9px] font-semibold tracking-[0.08em] text-[var(--color-ink-faint)] uppercase">
            Current AOS mode
          </p>
          <p className="mt-1 text-[13px] font-semibold text-[var(--color-warning)]">SUGGEST</p>
          <p className="mt-1 text-[10px] text-[var(--color-ink-faint)]">
            Observation + recommendations only. No autonomous business effects.
          </p>
        </div>
        <div className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-base-900)] px-3.5 py-3">
          <p className="text-[9px] font-semibold tracking-[0.08em] text-[var(--color-ink-faint)] uppercase">
            Business authority
          </p>
          <p className="mt-1 text-[13px] font-semibold text-[var(--color-healthy)]">
            QUICKFURNO CORE
          </p>
          <p className="mt-1 text-[10px] text-[var(--color-ink-faint)]">
            AOS can detect, reason, simulate and recommend. Core remains final authority.
          </p>
        </div>
        <div className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-base-900)] px-3.5 py-3">
          <p className="text-[9px] font-semibold tracking-[0.08em] text-[var(--color-ink-faint)] uppercase">
            Initial lead exposure
          </p>
          <p className="mt-1 text-[13px] font-semibold text-[var(--color-ink)]">3 vendors</p>
          <p className="mt-1 text-[10px] text-[var(--color-ink-faint)]">
            Any 4th+ vendor path stays recommendation + owner approval.
          </p>
        </div>
      </div>

      <div className="grid min-h-[690px] gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="overflow-hidden rounded-[var(--radius-panel)] border border-[var(--color-line)] bg-[var(--color-base-950)]">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            fitView
            fitViewOptions={{ padding: 0.08, minZoom: 0.2, maxZoom: 0.75 }}
            minZoom={0.16}
            maxZoom={1.5}
            nodesDraggable={false}
            nodesConnectable={false}
            edgesReconnectable={false}
            deleteKeyCode={null}
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
              <div className="border-b border-[var(--color-line)] pb-3">
                <p className="text-[9px] font-semibold tracking-[0.08em] text-[var(--color-ink-faint)] uppercase">
                  Selected capability
                </p>
                <h2 className="mt-1 text-[15px] font-semibold text-[var(--color-ink)]">
                  {selected.label}
                </h2>
              </div>
              <dl className="mt-4 space-y-3 text-[11px]">
                {[
                  ['Node ID', selected.nodeId],
                  ['Owner', selected.owner],
                  ['Group', selected.group],
                  ['Status', selected.status],
                  ['Authority', selected.authority],
                ].map(([term, detail]) => (
                  <div key={term} className="grid grid-cols-[86px_minmax(0,1fr)] gap-3">
                    <dt className="text-[var(--color-ink-faint)]">{term}</dt>
                    <dd className="break-words font-medium text-[var(--color-ink-muted)]">
                      {detail}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="mt-4 border-t border-[var(--color-line)] pt-4">
                <p className="text-[9px] font-semibold tracking-[0.08em] text-[var(--color-ink-faint)] uppercase">
                  Implementation
                </p>
                <code className="mt-2 block break-all rounded-[6px] bg-[var(--color-base-850)] px-2.5 py-2 text-[10px] leading-relaxed text-[var(--color-cyan)]">
                  {selected.implementationRef}
                </code>
              </div>
              <p className="mt-4 border-t border-[var(--color-line)] pt-4 text-[10.5px] leading-relaxed text-[var(--color-ink-muted)]">
                {selected.description}
              </p>
            </>
          )}
        </aside>
      </div>

      <div className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-base-900)] px-3.5 py-3">
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {AOS_PIPELINE_EDGE_KINDS.map((kind) => {
            const visual = EDGE_STYLE[kind];
            return (
              <span
                key={kind}
                className="flex items-center gap-1.5 text-[8.5px] text-[var(--color-ink-muted)]"
              >
                <span
                  className="inline-block w-5"
                  style={{
                    borderTop:
                      '2px ' +
                      (visual.dash === undefined ? 'solid' : 'dashed') +
                      ' ' +
                      visual.stroke,
                  }}
                />
                {kind}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
