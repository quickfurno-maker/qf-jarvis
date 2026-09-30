'use client';

import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ViewportPortal,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import {
  AGENT_FLOW_AUTHORITIES,
  AGENT_FLOW_EDGE_KINDS,
  AGENT_FLOW_NODE_KINDS,
  RIYA_WHATSAPP_CLIENT_FLOW_V1,
  type AgentFlowAuthority,
  type AgentFlowEdgeDefinition,
  type AgentFlowEdgeKind,
  type AgentFlowNodeDefinition,
  type AgentFlowNodeKind,
} from '@qf-jarvis/agent-flow-registry';
import { useMemo, useState } from 'react';

interface FlowNodeData extends Record<string, unknown> {
  readonly definition: AgentFlowNodeDefinition;
}

type FilterValue<T extends string> = 'ALL' | T;

const POSITIONS: Readonly<Record<string, { readonly x: number; readonly y: number }>> = {
  'riya.trigger.whatsapp-inbound': { x: 0, y: 260 },
  'riya.queue.claim-turn': { x: 280, y: 260 },
  'riya.context.turn-material': { x: 620, y: 80 },
  'riya.context.conversation': { x: 620, y: 430 },
  'riya.memory.client-journey': { x: 900, y: 0 },
  'riya.memory.lifetime': { x: 900, y: 140 },
  'riya.memory.vendor-journey': { x: 900, y: 280 },
  'riya.context.core-availability': { x: 900, y: 420 },
  'riya.detect.vendor-feedback': { x: 1250, y: 70 },
  'riya.action.record-vendor-feedback': { x: 1530, y: 0 },
  'riya.context.refresh-after-feedback': { x: 1810, y: 0 },
  'riya.condition.request-match': { x: 1250, y: 350 },
  'riya.action.request-match': { x: 1530, y: 280 },
  'riya.context.refresh-after-match': { x: 1810, y: 280 },
  'riya.intelligence.client-os': { x: 2200, y: 140 },
  'riya.agent.specialist-runtime': { x: 2480, y: 300 },
  'riya.action.write-reply': { x: 2810, y: 300 },
  'riya.queue.complete': { x: 3090, y: 300 },
};

const GROUP_BOUNDS: Readonly<
  Record<string, { readonly x: number; readonly y: number; readonly width: number; readonly height: number }>
> = {
  'riya.inbound': { x: -70, y: -90, width: 590, height: 690 },
  'riya.context': { x: 560, y: -90, width: 600, height: 690 },
  'riya.pre-agent-actions': { x: 1190, y: -90, width: 890, height: 690 },
  'riya.intelligence': { x: 2140, y: -90, width: 610, height: 690 },
  'riya.response': { x: 2770, y: -90, width: 620, height: 690 },
};

const KIND_STYLES: Readonly<Record<AgentFlowNodeKind, string>> = {
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
  Record<AgentFlowEdgeKind, { readonly stroke: string; readonly strokeDasharray?: string }>
> = {
  CONTROL: { stroke: '#64708a' },
  DATA: { stroke: '#4d8dff', strokeDasharray: '5 5' },
  COMMAND: { stroke: '#2fd39b' },
  RESULT: { stroke: '#38d1e0' },
  EVENT: { stroke: '#9d7bff', strokeDasharray: '2 5' },
};

const AUTHORITY_HELP: Readonly<Record<AgentFlowAuthority, string>> = {
  PRESENTATION_ONLY: 'UI-only',
  READ_ONLY: 'Read',
  AGENT_INTERPRET: 'Interpret',
  AGENT_PROPOSE: 'Propose',
  ORCHESTRATION_CONTROL: 'Orchestrate',
  CORE_GOVERNED_ACTION: 'Core action',
  HUMAN_CONTROL: 'Human',
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

function matchesQuery(node: AgentFlowNodeDefinition, query: string): boolean {
  if (query.length === 0) return true;
  const haystack = [
    node.label,
    node.nodeId,
    node.description,
    node.implementationRef,
    node.implementationVersionRef,
    node.authority,
    node.kind,
    node.stage,
    ...node.tags,
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export function AgentFlowCanvas() {
  const flow = RIYA_WHATSAPP_CLIENT_FLOW_V1;
  const [selectedId, setSelectedId] = useState('riya.agent.specialist-runtime');
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<FilterValue<AgentFlowNodeKind>>('ALL');
  const [authorityFilter, setAuthorityFilter] =
    useState<FilterValue<AgentFlowAuthority>>('ALL');
  const [edgeKindFilter, setEdgeKindFilter] = useState<FilterValue<AgentFlowEdgeKind>>('ALL');

  const visibleNodeIds = useMemo(() => {
    return new Set(
      flow.nodes
        .filter(
          (node) =>
            matchesQuery(node, query.trim()) &&
            (kindFilter === 'ALL' || node.kind === kindFilter) &&
            (authorityFilter === 'ALL' || node.authority === authorityFilter),
        )
        .map((node) => node.nodeId),
    );
  }, [authorityFilter, flow.nodes, kindFilter, query]);

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
        hidden: !visibleNodeIds.has(definition.nodeId),
      })),
    [flow.nodes, visibleNodeIds],
  );

  const edges = useMemo<Edge[]>(
    () =>
      flow.edges.map((definition) => ({
        ...edgeFor(definition),
        hidden:
          (edgeKindFilter !== 'ALL' && definition.kind !== edgeKindFilter) ||
          !visibleNodeIds.has(definition.sourceNodeId) ||
          !visibleNodeIds.has(definition.targetNodeId),
      })),
    [edgeKindFilter, flow.edges, visibleNodeIds],
  );

  const selected = flow.nodes.find((node) => node.nodeId === selectedId) ?? flow.nodes[0];
  const governedActions = flow.nodes.filter(
    (node) => node.effect === 'GOVERNED_ACTION' || node.effect === 'CHANNEL_REQUEST',
  ).length;
  const projections = flow.nodes.filter((node) => node.executionRole === 'PROJECTION').length;
  const visibleEdges = edges.filter((edge) => edge.hidden !== true).length;

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ['Flow', flow.label],
          ['Nodes', String(flow.nodes.length)],
          ['Visible', String(visibleNodeIds.size)],
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
          Read-only · schema v{flow.registrySchemaVersion} · flow v{flow.flowVersion}
        </span>
      </div>

      <div className="grid gap-2 lg:grid-cols-[minmax(220px,1fr)_180px_220px_190px]">
        <label className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-base-900)] px-3 py-2">
          <span className="block text-[8.5px] font-semibold tracking-[0.08em] text-[var(--color-ink-faint)] uppercase">
            Search nodes
          </span>
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder="label, id, tag, implementation..."
            className="mt-1 w-full bg-transparent text-[11px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-faint)]"
          />
        </label>
        <label className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-base-900)] px-3 py-2">
          <span className="block text-[8.5px] font-semibold tracking-[0.08em] text-[var(--color-ink-faint)] uppercase">
            Node kind
          </span>
          <select
            value={kindFilter}
            onChange={(event) => {
              setKindFilter(event.target.value as FilterValue<AgentFlowNodeKind>);
            }}
            className="mt-1 w-full bg-[var(--color-base-900)] text-[11px] text-[var(--color-ink)] outline-none"
          >
            <option value="ALL">All kinds</option>
            {AGENT_FLOW_NODE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </label>
        <label className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-base-900)] px-3 py-2">
          <span className="block text-[8.5px] font-semibold tracking-[0.08em] text-[var(--color-ink-faint)] uppercase">
            Authority
          </span>
          <select
            value={authorityFilter}
            onChange={(event) => {
              setAuthorityFilter(event.target.value as FilterValue<AgentFlowAuthority>);
            }}
            className="mt-1 w-full bg-[var(--color-base-900)] text-[11px] text-[var(--color-ink)] outline-none"
          >
            <option value="ALL">All authorities</option>
            {AGENT_FLOW_AUTHORITIES.map((authority) => (
              <option key={authority} value={authority}>
                {authority}
              </option>
            ))}
          </select>
        </label>
        <label className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-base-900)] px-3 py-2">
          <span className="block text-[8.5px] font-semibold tracking-[0.08em] text-[var(--color-ink-faint)] uppercase">
            Edge kind
          </span>
          <select
            value={edgeKindFilter}
            onChange={(event) => {
              setEdgeKindFilter(event.target.value as FilterValue<AgentFlowEdgeKind>);
            }}
            className="mt-1 w-full bg-[var(--color-base-900)] text-[11px] text-[var(--color-ink)] outline-none"
          >
            <option value="ALL">All edges</option>
            {AGENT_FLOW_EDGE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-2 xl:grid-cols-3">
        <div className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-base-900)] px-3.5 py-3">
          <p className="text-[9px] font-semibold tracking-[0.08em] text-[var(--color-ink-faint)] uppercase">
            Node legend
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {AGENT_FLOW_NODE_KINDS.map((kind) => (
              <span
                key={kind}
                className={`rounded-full border px-2 py-1 text-[8.5px] text-[var(--color-ink-muted)] ${KIND_STYLES[kind]}`}
              >
                {kind}
              </span>
            ))}
          </div>
        </div>

        <div className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-base-900)] px-3.5 py-3">
          <p className="text-[9px] font-semibold tracking-[0.08em] text-[var(--color-ink-faint)] uppercase">
            Authority legend
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {AGENT_FLOW_AUTHORITIES.map((authority) => (
              <span
                key={authority}
                title={authority}
                className="rounded-full border border-[var(--color-line)] bg-[var(--color-base-850)] px-2 py-1 text-[8.5px] text-[var(--color-ink-muted)]"
              >
                {AUTHORITY_HELP[authority]}
              </span>
            ))}
          </div>
        </div>

        <div className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-base-900)] px-3.5 py-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[9px] font-semibold tracking-[0.08em] text-[var(--color-ink-faint)] uppercase">
              Edge legend
            </p>
            <span className="text-[8.5px] text-[var(--color-ink-faint)]">{visibleEdges} visible</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-2">
            {AGENT_FLOW_EDGE_KINDS.map((kind) => {
              const style = EDGE_STYLE[kind];
              return (
                <span key={kind} className="flex items-center gap-1.5 text-[8.5px] text-[var(--color-ink-muted)]">
                  <span
                    className="inline-block w-5"
                    style={{
                      borderTop: `2px ${style.strokeDasharray === undefined ? 'solid' : 'dashed'} ${style.stroke}`,
                    }}
                  />
                  {kind}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid min-h-[720px] gap-4 xl:grid-cols-[minmax(0,1fr)_350px]">
        <div className="overflow-hidden rounded-[var(--radius-panel)] border border-[var(--color-line)] bg-[var(--color-base-950)]">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            fitView
            fitViewOptions={{ padding: 0.08, minZoom: 0.25, maxZoom: 0.78 }}
            minZoom={0.18}
            maxZoom={1.6}
            nodesDraggable={false}
            nodesConnectable={false}
            edgesReconnectable={false}
            deleteKeyCode={null}
            elementsSelectable
            onNodeClick={(_, node) => {
              setSelectedId(node.id);
            }}
          >
            <ViewportPortal>
              {flow.groups
                .slice()
                .sort((left, right) => left.order - right.order)
                .map((group) => {
                  const bounds = GROUP_BOUNDS[group.groupId];
                  if (bounds === undefined) return null;
                  const hasVisibleNode = flow.nodes.some(
                    (node) => node.groupId === group.groupId && visibleNodeIds.has(node.nodeId),
                  );
                  return (
                    <div
                      key={group.groupId}
                      className={[
                        'pointer-events-none absolute rounded-[18px] border border-[var(--color-line)] bg-[rgba(17,22,33,0.34)]',
                        hasVisibleNode ? 'opacity-100' : 'opacity-35',
                      ].join(' ')}
                      style={{
                        transform: `translate(${String(bounds.x)}px, ${String(bounds.y)}px)`,
                        width: bounds.width,
                        height: bounds.height,
                      }}
                    >
                      <div className="absolute top-3 left-3 max-w-[210px] rounded-[8px] border border-[var(--color-line)] bg-[rgba(10,13,20,0.92)] px-2.5 py-2">
                        <p className="text-[9px] font-semibold tracking-[0.08em] text-[var(--color-ink-muted)] uppercase">
                          {group.label}
                        </p>
                        <p className="mt-1 text-[8.5px] leading-relaxed text-[var(--color-ink-faint)]">
                          {group.description}
                        </p>
                      </div>
                    </div>
                  );
                })}
            </ViewportPortal>
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
                  ['Node version', 'v' + String(selected.nodeVersion)],
                  ['Group', selected.groupId],
                ].map(([term, detail]) => (
                  <div key={term} className="grid grid-cols-[98px_minmax(0,1fr)] gap-3">
                    <dt className="text-[var(--color-ink-faint)]">{term}</dt>
                    <dd className="break-words font-medium text-[var(--color-ink-muted)]">{detail}</dd>
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
                <div className="mt-2 grid grid-cols-[108px_minmax(0,1fr)] gap-2 text-[9.5px]">
                  <span className="text-[var(--color-ink-faint)]">Version ref</span>
                  <code className="break-all text-[var(--color-ink-muted)]">
                    {selected.implementationVersionRef}
                  </code>
                  <span className="text-[var(--color-ink-faint)]">Flow baseline</span>
                  <code className="break-all text-[var(--color-ink-muted)]">
                    {flow.implementationBaselineRef}
                  </code>
                  <span className="text-[var(--color-ink-faint)]">Verified</span>
                  <span className="text-[var(--color-ink-muted)]">{flow.verifiedAt}</span>
                </div>
              </div>

              <div className="mt-4 border-t border-[var(--color-line)] pt-4">
                <p className="text-[9.5px] font-semibold tracking-[0.08em] text-[var(--color-ink-faint)] uppercase">
                  Canvas control
                </p>
                {selected.canvasEditable.length === 0 ? (
                  <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-ink-muted)]">
                    Locked in Phase 1. This node is visible but has no canvas-editable configuration.
                  </p>
                ) : (
                  <>
                    <p className="mt-2 text-[10px] leading-relaxed text-[var(--color-ink-faint)]">
                      Declared future-safe configuration keys. Phase 1 exposes metadata only; none are writable here.
                    </p>
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
                  </>
                )}
              </div>

              <div className="mt-4 border-t border-[var(--color-line)] pt-4">
                <p className="text-[10.5px] leading-relaxed text-[var(--color-ink-muted)]">
                  {selected.description}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {selected.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-[var(--color-line)] px-2 py-1 text-[8.5px] text-[var(--color-ink-faint)]"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
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
