import { Cell, DataTable, Row } from '@/components/primitives/DataTable';
import { Notice, Panel } from '@/components/primitives/Panel';
import { PageHeader } from '@/components/shell/PageHeader';
import { CapabilityBadge, StatusPill } from '@/components/system/StatusPill';
import { controlPlane } from '@/lib/control-plane';
import { formatCount } from '@/lib/formatting/number';

/**
 * Evaluations (JOS-01A).
 *
 * Suite health across the dimensions that matter, with one refusal stated plainly: a passing
 * fixture suite is not a production certification. A dashboard that implied otherwise would be
 * manufacturing confidence, which is worse than showing nothing at all.
 */
export default function EvaluationsPage() {
  const dimensions = controlPlane().evaluations();
  const total = dimensions.reduce((sum, dimension) => sum + dimension.caseCount, 0);
  const subtitle =
    formatCount(total) + ' cases across ' + String(dimensions.length) + ' dimensions';

  return (
    <>
      <PageHeader
        breadcrumb={['Intelligence', 'Evaluations']}
        title="Evaluation suites"
        purpose="Fixture-based quality and safety signal across the dimensions that gate a model or provider change."
        status={<CapabilityBadge lifecycle="SHADOW" />}
      />

      <div className="space-y-5">
        <Notice tone="warning" title="No production certification is claimed">
          These suites run against fixtures. They are a signal for a human deciding whether a change
          is safe to consider — not evidence that anything is approved for production.
        </Notice>

        <Panel title="Dimensions" subtitle={subtitle}>
          <DataTable
            caption="Evaluation dimensions with case counts and readiness."
            head={['Dimension', 'Cases', 'State', 'Detail']}
          >
            {dimensions.map((dimension) => (
              <Row key={dimension.id}>
                <Cell nowrap>{dimension.label}</Cell>
                <Cell muted nowrap>
                  <span className="tabular">{formatCount(dimension.caseCount)}</span>
                </Cell>
                <Cell nowrap>
                  <StatusPill state={dimension.state} />
                </Cell>
                <Cell muted>{dimension.detail}</Cell>
              </Row>
            ))}
          </DataTable>
        </Panel>

        <Panel title="What a suite gates" subtitle="And what it does not">
          <ul className="space-y-2.5 text-[12px] leading-relaxed text-[var(--color-ink-muted)]">
            <li>A red dimension blocks a model or provider change from being considered.</li>
            <li>A green dimension is evidence for a human, not an approval by a machine.</li>
            <li>No suite result activates anything, and none is a rollout decision.</li>
          </ul>
        </Panel>
      </div>
    </>
  );
}
