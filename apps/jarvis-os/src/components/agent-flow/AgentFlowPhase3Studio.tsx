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
  AAROHI_ACQUISITION_FLOW_V1,
  AGENT_FLOW_AUTHORITIES,
  AGENT_FLOW_NODE_KINDS,
  ANISHA_VENDOR_FLOW_V1,
  RIYA_PHASE3_CONTROLLED_FLOW_V2,
  type AgentFlowAuthority,
  type AgentFlowDefinition,
  type AgentFlowNodeDefinition,
  type AgentFlowNodeKind,
} from '@qf-jarvis/agent-flow-registry';
import { buildAgentFlowReplayHistory } from '@qf-jarvis/agent-flow-governance';
import {
  AGENT_FLOW_ALL_VIEW_V1,
  PHASE3_ORCHESTRATION_PROFILES,
} from '@qf-jarvis/agent-flow-orchestration';
import type {
  AgentFlowTraceEvent,
  AgentFlowTraceReadResult,
} from '@qf-jarvis/agent-flow-trace-contract';
import { useEffect, useMemo, useState } from 'react';

import { useOperatorCommands } from '@/components/operator/OperatorCommandProvider';

type StudioView = 'RIYA' | 'ANISHA' | 'AAROHI' | 'ALL';
type FilterValue<T extends string> = 'ALL' | T;

interface FlowNodeData extends Record<string, unknown> {
  readonly definition: AgentFlowNodeDefinition;
  readonly traceEvent?: AgentFlowTraceEvent;
}

const FLOW_BY_VIEW: Readonly<Record<Exclude<StudioView, 'ALL'>, AgentFlowDefinition>> =
  Object.freeze({
    RIYA: RIYA_PHASE3_CONTROLLED_FLOW_V2,
    ANISHA: ANISHA_VENDOR_FLOW_V1,
    AAROHI: AAROHI_ACQUISITION_FLOW_V1,
  });

const KIND_BORDER: Readonly<Record<AgentFlowNodeKind, string>> = {
  TRIGGER: 'border-[var(--color-cyan)]/55',
  CONTEXT: 'border-[var(--color-info)]/55',
  MEMORY: 'border-[var(--color-violet)]/55',
  INTELLIGENCE: 'border-[var(--color-accent-bright)]/60',
  ORCHESTRATION: 'border-[var(--color-warning)]/55',
  CAPABILITY: 'border-[var(--color-healthy)]/55',
  CHANNEL: 'border-[var(--color-cyan)]/55',
  HUMAN: 'border-[var(--color-warning)]/70',
  SYSTEM: 'border-[var(--color-line-strong)]',
};

function traceRing(event: AgentFlowTraceEvent | undefined): string {
  if (event === undefined) return '';
  if (event.status === 'FAILED') return 'ring-2 ring-[var(--color-danger)]';
  if (event.status === 'RUNNING') return 'ring-2 ring-[var(--color-warning)]';
  if (event.status === 'SUCCEEDED') return 'ring-2 ring-[var(--color-healthy)]';
  return 'ring-1 ring-[var(--color-violet)]';
}

function FlowNode({ data, selected }: NodeProps<Node<FlowNodeData>>) {
  const node = data.definition;
  return (
    <div
      className={[
        'w-[220px] rounded-[10px] border bg-[var(--color-base-900)] px-3.5 py-3 shadow-[0_12px_28px_rgba(0,0,0,0.22)]',
        KIND_BORDER[node.kind],
        traceRing(data.traceEvent),
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
          {node.kind}
        </span>
        <span className="rounded-full border border-[var(--color-line)] px-1.5 py-0.5 text-[8px] text-[var(--color-ink-muted)]">
          {node.status}
        </span>
      </div>
      <p className="mt-2 text-[12px] font-semibold leading-snug text-[var(--color-ink)]">
        {node.label}
      </p>
      <p className="mt-1 line-clamp-2 text-[9px] leading-relaxed text-[var(--color-ink-faint)]">
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

function layout(flow: AgentFlowDefinition) {
  const sortedGroups = [...flow.groups].sort((left, right) => left.order - right.order);
  const groupIndex = new Map(sortedGroups.map((group, index) => [group.groupId, index] as const));
  const nodeIndex = new Map<string, number>();
  const positions = new Map<string, { readonly x: number; readonly y: number }>();

  for (const node of flow.nodes) {
    const index = nodeIndex.get(node.groupId) ?? 0;
    nodeIndex.set(node.groupId, index + 1);
    const group = groupIndex.get(node.groupId) ?? 0;
    positions.set(node.nodeId, {
      x: group * 600 + (index % 2) * 250 + 40,
      y: 110 + Math.floor(index / 2) * 155,
    });
  }

  const bounds = new Map(
    sortedGroups.map((group, index) => {
      const count = flow.nodes.filter((node) => node.groupId === group.groupId).length;
      const rows = Math.max(1, Math.ceil(count / 2));
      return [
        group.groupId,
        { x: index * 600, y: 0, width: 560, height: Math.max(360, 170 + rows * 155) },
      ] as const;
    }),
  );
  return { positions, bounds, sortedGroups };
}

function matches(node: AgentFlowNodeDefinition, query: string): boolean {
  if (query.length === 0) return true;
  return [
    node.label,
    node.nodeId,
    node.description,
    node.implementationRef,
    node.authority,
    node.kind,
    node.status,
    ...node.tags,
  ]
    .join(' ')
    .toLowerCase()
    .includes(query.toLowerCase());
}

function AllView() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        {(['RIYA', 'ANISHA', 'AAROHI'] as const).map((actor) => {
          const flow = FLOW_BY_VIEW[actor];
          const profile = PHASE3_ORCHESTRATION_PROFILES.find((item) => item.actor === actor);
          return (
            <div
              key={actor}
              className="rounded-[var(--radius-panel)] border border-[var(--color-line)] bg-[var(--color-base-900)] p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[14px] font-semibold text-[var(--color-ink)]">{actor}</h3>
                <span className="rounded-full border border-[var(--color-line)] px-2 py-1 text-[8px] text-[var(--color-warning)]">
                  {flow.status}
                </span>
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-[var(--color-ink-muted)]">
                {flow.label}
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-[9px]">
                <Fact label="Nodes" value={String(flow.nodes.length)} />
                <Fact label="Edges" value={String(flow.edges.length)} />
                <Fact label="Conditions" value={String(profile?.conditions.length ?? 0)} />
                <Fact label="Waits" value={String(profile?.waits.length ?? 0)} />
              </dl>
            </div>
          );
        })}
      </div>

      <div className="rounded-[var(--radius-panel)] border border-[var(--color-line)] bg-[var(--color-base-900)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[9px] font-semibold tracking-[0.08em] text-[var(--color-ink-faint)] uppercase">
              Cross-agent ALL view
            </p>
            <p className="mt-1 text-[12px] font-semibold text-[var(--color-ink)]">
              Event-driven ownership handoffs
            </p>
          </div>
          <span className="rounded-full border border-[var(--color-line)] px-2.5 py-1 text-[8.5px] font-semibold text-[var(--color-healthy)]">
            Core authority · execution none
          </span>
        </div>
        <div className="mt-4 space-y-2">
          {AGENT_FLOW_ALL_VIEW_V1.crossAgentLinks.map((link) => (
            <div
              key={link.linkId}
              className="flex flex-wrap items-center gap-2 rounded-[8px] border border-[var(--color-line)] bg-[var(--color-base-850)] px-3 py-3"
            >
              <span className="font-mono text-[10px] text-[var(--color-accent-bright)]">
                {link.fromAgent}
              </span>
              <span className="text-[var(--color-ink-faint)]">→</span>
              <span className="font-mono text-[10px] text-[var(--color-cyan)]">{link.toAgent}</span>
              <span className="text-[9px] text-[var(--color-ink-muted)]">{link.partyType}</span>
              <span className="text-[9px] text-[var(--color-ink-faint)]">{link.reason}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[9.5px] leading-relaxed text-[var(--color-ink-faint)]">
          A visual handoff never changes ownership. Core assignment evidence is required before the
          governed handoff package can even produce a proposal.
        </p>
      </div>
    </div>
  );
}

function Fact({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-[7px] border border-[var(--color-line)] px-2.5 py-2">
      <dt className="text-[7.5px] font-semibold tracking-[0.07em] text-[var(--color-ink-faint)] uppercase">
        {label}
      </dt>
      <dd className="mt-1 font-mono text-[9.5px] text-[var(--color-ink-muted)]">{value}</dd>
    </div>
  );
}

export function AgentFlowPhase3Studio() {
  const { readAgentFlowTrace } = useOperatorCommands();
  const [view, setView] = useState<StudioView>('RIYA');
  const flow = view === 'ALL' ? null : FLOW_BY_VIEW[view];
  const [selectedId, setSelectedId] = useState(RIYA_PHASE3_CONTROLLED_FLOW_V2.rootNodeId);
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<FilterValue<AgentFlowNodeKind>>('ALL');
  const [authorityFilter, setAuthorityFilter] =
    useState<FilterValue<AgentFlowAuthority>>('ALL');
  const [traceState, setTraceState] = useState<AgentFlowTraceReadResult | null>(null);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);

  useEffect(() => {
    if (flow !== null) setSelectedId(flow.rootNodeId);
    setSelectedTraceId(null);
  }, [flow]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async (): Promise<void> => {
      try {
        const result = await readAgentFlowTrace();
        if (!cancelled) setTraceState(result);
      } catch {
        if (!cancelled) {
          setTraceState(Object.freeze({ available: false, reason: 'SOURCE_UNREACHABLE' }));
        }
      } finally {
        if (!cancelled) timer = setTimeout(() => void poll(), 2_000);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [readAgentFlowTrace]);

  const replayHistory = useMemo(() => {
    if (!traceState?.available || flow === null) return [];
    return buildAgentFlowReplayHistory(traceState.snapshot).filter((run) => run.actor === flow.actor);
  }, [flow, traceState]);
  const activeTraceId = selectedTraceId ?? replayHistory[0]?.traceId;
  const activeEvents = useMemo(() => {
    if (!traceState?.available || activeTraceId === undefined) return [];
    return traceState.snapshot.events.filter((event) => event.traceId === activeTraceId);
  }, [activeTraceId, traceState]);
  const eventByNode = useMemo(() => {
    const map = new Map<string, AgentFlowTraceEvent>();
    for (const event of activeEvents) {
      if (event.nodeId !== undefined) map.set(event.nodeId, event);
    }
    return map;
  }, [activeEvents]);

  const computed = useMemo(() => (flow === null ? null : layout(flow)), [flow]);
  const visibleIds = useMemo(() => {
    if (flow === null) return new Set<string>();
    return new Set(
      flow.nodes
        .filter(
          (node) =>
            matches(node, query.trim()) &&
            (kindFilter === 'ALL' || node.kind === kindFilter) &&
            (authorityFilter === 'ALL' || node.authority === authorityFilter),
        )
        .map((node) => node.nodeId),
    );
  }, [authorityFilter, flow, kindFilter, query]);

  const nodes = useMemo<Node<FlowNodeData>[]>(() => {
    if (flow === null || computed === null) return [];
    return flow.nodes.map((definition) => {
      const traceEvent = eventByNode.get(definition.nodeId);
      return {
        id: definition.nodeId,
        type: 'agentFlow',
        position: computed.positions.get(definition.nodeId) ?? { x: 0, y: 0 },
        data: {
          definition,
          ...(traceEvent === undefined ? {} : { traceEvent }),
        },
        draggable: false,
        connectable: false,
        selectable: true,
        hidden: !visibleIds.has(definition.nodeId),
      };
    });
  }, [computed, eventByNode, flow, visibleIds]);

  const edges = useMemo<Edge[]>(() => {
    if (flow === null) return [];
    return flow.edges.map((definition) => ({
      id: definition.edgeId,
      source: definition.sourceNodeId,
      target: definition.targetNodeId,
      type: 'smoothstep',
      label: definition.label,
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
      style: { stroke: definition.kind === 'COMMAND' ? '#2fd39b' : '#64708a', strokeWidth: 1.4 },
      labelStyle: { fill: '#98a3b8', fontSize: 8.5 },
      hidden:
        !visibleIds.has(definition.sourceNodeId) || !visibleIds.has(definition.targetNodeId),
    }));
  }, [flow, visibleIds]);

  const selected = flow?.nodes.find((node) => node.nodeId === selectedId);
  const selectedRun = replayHistory.find((run) => run.traceId === activeTraceId);
  const selectedReplay = selectedRun?.nodes.find((node) => node.nodeId === selected?.nodeId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-base-900)] p-2">
        {(['RIYA', 'ANISHA', 'AAROHI', 'ALL'] as const).map((candidate) => (
          <button
            key={candidate}
            type="button"
            onClick={() => { setView(candidate); }}
            className={[
              'rounded-[7px] border px-3 py-1.5 text-[9.5px] font-semibold tracking-[0.05em]',
              view === candidate
                ? 'border-[var(--color-accent-dim)] bg-[var(--color-base-800)] text-[var(--color-accent-bright)]'
                : 'border-[var(--color-line)] text-[var(--color-ink-faint)]',
            ].join(' ')}
          >
            {candidate}
          </button>
        ))}
        <span className="ml-auto self-center text-[8.5px] font-semibold tracking-[0.07em] text-[var(--color-warning)] uppercase">
          Phase 3 · controlled · no production activation
        </span>
      </div>

      {view === 'ALL' || flow === null || computed === null ? (
        <AllView />
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            <Fact label="Flow" value={flow.actor} />
            <Fact label="Nodes" value={String(flow.nodes.length)} />
            <Fact label="Edges" value={String(flow.edges.length)} />
            <Fact
              label="Shadow nodes"
              value={String(flow.nodes.filter((node) => node.status === 'SHADOW').length)}
            />
            <Fact
              label="Disabled nodes"
              value={String(flow.nodes.filter((node) => node.status === 'DISABLED').length)}
            />
          </div>

          <section className="rounded-[var(--radius-panel)] border border-[var(--color-line)] bg-[var(--color-base-900)] p-3.5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[9px] font-semibold tracking-[0.08em] text-[var(--color-ink-faint)] uppercase">
                  {flow.actor} live trace / replay
                </p>
                <p className="mt-1 text-[10.5px] text-[var(--color-ink-muted)]">
                  {selectedRun === undefined
                    ? 'No trace available for this agent yet.'
                    : `${selectedRun.status} · ${String(selectedRun.durationMs ?? 'running')}ms · ${selectedRun.outcome ?? 'in progress'}`}
                </p>
              </div>
              <span className="rounded-full border border-[var(--color-line)] px-2.5 py-1 text-[8px] text-[var(--color-ink-faint)]">
                replay is read-only
              </span>
            </div>
            {replayHistory.length === 0 ? null : (
              <select
                value={selectedTraceId ?? 'LATEST'}
                onChange={(event) =>
                  { setSelectedTraceId(event.target.value === 'LATEST' ? null : event.target.value); }
                }
                className="mt-3 max-w-[520px] rounded-[7px] border border-[var(--color-line)] bg-[var(--color-base-850)] px-3 py-2 text-[9.5px] text-[var(--color-ink-muted)] outline-none"
              >
                <option value="LATEST">LIVE · latest {flow.actor} run</option>
                {replayHistory.map((run, index) => (
                  <option key={run.traceId} value={run.traceId}>
                    {index === 0 ? 'Latest' : 'Replay'} · {run.traceId.slice(0, 16)} · {run.status}
                  </option>
                ))}
              </select>
            )}
          </section>

          <div className="grid gap-2 lg:grid-cols-[minmax(220px,1fr)_190px_220px]">
            <label className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-base-900)] px-3 py-2">
              <span className="text-[8px] font-semibold tracking-[0.07em] text-[var(--color-ink-faint)] uppercase">
                Search
              </span>
              <input
                value={query}
                onChange={(event) => { setQuery(event.target.value); }}
                placeholder="node, capability, tag..."
                className="mt-1 block w-full bg-transparent text-[10.5px] text-[var(--color-ink)] outline-none"
              />
            </label>
            <label className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-base-900)] px-3 py-2">
              <span className="text-[8px] font-semibold text-[var(--color-ink-faint)] uppercase">
                Node kind
              </span>
              <select
                value={kindFilter}
                onChange={(event) =>
                  { setKindFilter(event.target.value as FilterValue<AgentFlowNodeKind>); }
                }
                className="mt-1 block w-full bg-[var(--color-base-900)] text-[10px] text-[var(--color-ink)] outline-none"
              >
                <option value="ALL">All kinds</option>
                {AGENT_FLOW_NODE_KINDS.map((kind) => (
                  <option key={kind}>{kind}</option>
                ))}
              </select>
            </label>
            <label className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-base-900)] px-3 py-2">
              <span className="text-[8px] font-semibold text-[var(--color-ink-faint)] uppercase">
                Authority
              </span>
              <select
                value={authorityFilter}
                onChange={(event) =>
                  { setAuthorityFilter(event.target.value as FilterValue<AgentFlowAuthority>); }
                }
                className="mt-1 block w-full bg-[var(--color-base-900)] text-[10px] text-[var(--color-ink)] outline-none"
              >
                <option value="ALL">All authorities</option>
                {AGENT_FLOW_AUTHORITIES.map((authority) => (
                  <option key={authority}>{authority}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid min-h-[720px] gap-4 xl:grid-cols-[minmax(0,1fr)_350px]">
            <div className="overflow-hidden rounded-[var(--radius-panel)] border border-[var(--color-line)] bg-[var(--color-base-950)]">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={NODE_TYPES}
                fitView
                fitViewOptions={{ padding: 0.08, minZoom: 0.2, maxZoom: 0.75 }}
                minZoom={0.15}
                maxZoom={1.5}
                nodesDraggable={false}
                nodesConnectable={false}
                edgesReconnectable={false}
                deleteKeyCode={null}
                onNodeClick={(_, node) => { setSelectedId(node.id); }}
              >
                <ViewportPortal>
                  {computed.sortedGroups.map((group) => {
                    const bounds = computed.bounds.get(group.groupId);
                    if (bounds === undefined) return null;
                    return (
                      <div
                        key={group.groupId}
                        className="pointer-events-none absolute rounded-[18px] border border-[var(--color-line)] bg-[rgba(17,22,33,0.30)]"
                        style={{
                          transform: `translate(${String(bounds.x)}px, ${String(bounds.y)}px)`,
                          width: bounds.width,
                          height: bounds.height,
                        }}
                      >
                        <div className="absolute top-3 left-3 rounded-[7px] border border-[var(--color-line)] bg-[rgba(10,13,20,0.92)] px-2.5 py-1.5">
                          <p className="text-[8.5px] font-semibold text-[var(--color-ink-muted)]">
                            {group.label}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </ViewportPortal>
                <MiniMap
                  pannable
                  zoomable
                  maskColor="rgba(6,8,13,0.72)"
                  style={{ background: '#0a0d14', border: '1px solid #1e2534' }}
                />
                <Controls showInteractive={false} />
                <Background gap={24} size={1} color="#1e2534" />
              </ReactFlow>
            </div>

            <aside className="rounded-[var(--radius-panel)] border border-[var(--color-line)] bg-[var(--color-base-900)] p-4">
              {selected === undefined ? null : (
                <>
                  <p className="text-[8.5px] font-semibold tracking-[0.08em] text-[var(--color-ink-faint)] uppercase">
                    Selected node
                  </p>
                  <h3 className="mt-1 text-[15px] font-semibold text-[var(--color-ink)]">
                    {selected.label}
                  </h3>
                  <p className="mt-2 text-[10px] leading-relaxed text-[var(--color-ink-muted)]">
                    {selected.description}
                  </p>
                  <dl className="mt-4 space-y-2">
                    <Fact label="Node ID" value={selected.nodeId} />
                    <Fact label="Authority" value={selected.authority} />
                    <Fact label="Effect" value={selected.effect} />
                    <Fact label="Status" value={selected.status} />
                    <Fact label="Implementation" value={selected.implementationRef} />
                    <Fact
                      label="Trace"
                      value={
                        selectedReplay === undefined
                          ? 'not observed in selected run'
                          : `${selectedReplay.terminalStatus} · ${String(selectedReplay.durationMs ?? 'n/a')}ms`
                      }
                    />
                  </dl>
                  <div className="mt-4 rounded-[8px] border border-[var(--color-line)] bg-[var(--color-base-850)] p-3">
                    <p className="text-[8px] font-semibold text-[var(--color-healthy)] uppercase">
                      Code lock
                    </p>
                    <p className="mt-1 text-[9.5px] leading-relaxed text-[var(--color-ink-faint)]">
                      {selected.codeLocked
                        ? 'Capability implementation remains code-controlled.'
                        : 'No code-lock declaration.'}
                    </p>
                  </div>
                </>
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
