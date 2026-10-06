#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const c = JSON.parse(read('contracts/qfj-phase19-kubernetes-v1.json'));
const base = read('ops/kubernetes/base/all.yaml');
const cert = read('ops/kubernetes/overlays/certification/kustomization.yaml');
const jobs = read('ops/kubernetes/overlays/certification/artifact-check-jobs.yaml');
const auth = read('ops/kubernetes/overlays/certification/fixtures/auth.json');
const staging = read('ops/kubernetes/overlays/staging/kustomization.yaml');
const prod = read('ops/kubernetes/overlays/production/kustomization.yaml');
const workflow = read('.github/workflows/phase19-kubernetes-readiness.yml');
const checks = [];
const add = (name, ok) => checks.push([name, Boolean(ok)]);
const count = (text, needle) => text.split(needle).length - 1;
const matches = (text, pattern) => (text.match(pattern) ?? []).length;

add(
  'canonical Phase19 contract',
  c.contract === 'qfj.phase19.kubernetes.v1' && c.version === 1 && !c.productionKubernetesOperated,
);
add(
  'all current production digests are pinned',
  base.includes(c.images.jarvisOs.image) &&
    base.includes(c.images.jarvisGateway.image) &&
    base.includes(c.images.jarvisWorker.image),
);
add(
  'Kustomize packaging exists',
  cert.includes('../../base') && staging.includes('../../base') && prod.includes('../../base'),
);
add(
  'Jarvis OS probes distinguish readiness and liveness',
  base.includes('path: /login') && /tcpSocket:\s*\{\s*port:\s*http\s*\}/.test(base),
);
add(
  'strict 0600 auth boundary is preserved',
  base.includes('prepare-owner-only-config') &&
    base.includes('chmod 0600') &&
    base.includes('chown 10001:10001') &&
    /add:\s*\[\s*['"]CHOWN['"]\s*\]/.test(base),
);
add(
  'runtime pods remain non-root read-only and capability free',
  count(base, 'runAsNonRoot: true') >= 3 &&
    count(base, 'readOnlyRootFilesystem: true') >= 3 &&
    matches(base, /drop:\s*\[\s*['"]ALL['"]\s*\]/g) >= 4 &&
    base.includes('RuntimeDefault'),
);
add('service account tokens are disabled', base.includes('automountServiceAccountToken: false'));
add(
  'worker termination grace preserves lease safety',
  base.includes('terminationGracePeriodSeconds: 120'),
);
add(
  'multi-replica services have non-deadlocking PDBs',
  count(base, 'kind: PodDisruptionBudget') === 3 && count(base, 'maxUnavailable: 1') >= 3,
);
add(
  'Jarvis OS HPA is bounded',
  count(base, 'kind: HorizontalPodAutoscaler') === 1 &&
    base.includes('name: jarvis-os') &&
    base.includes('minReplicas: 2') &&
    base.includes('maxReplicas: 4'),
);
add(
  'gateway and worker replicas preserve DB budget',
  c.autoscaling.jarvisGateway.fixedReplicas === 2 &&
    c.autoscaling.jarvisWorker.fixedReplicas === 2 &&
    2 * 3 + 2 * 5 === c.autoscaling.jarvisApplicationDbCeiling &&
    base.includes('name: jarvis-gateway') &&
    base.includes('name: jarvis-worker'),
);
add(
  'topology spread and anti-affinity exist',
  count(base, 'topologySpreadConstraints:') >= 3 && count(base, 'podAntiAffinity:') >= 3,
);
add(
  'default deny plus bounded egress exists',
  base.includes('name: default-deny') &&
    base.includes('allow-dns-provider-db-egress') &&
    base.includes('port: 5432') &&
    base.includes('port: 6379'),
);
add(
  'no persistent business volume',
  !base.includes('persistentVolumeClaim') && !base.includes('hostPath:'),
);
add(
  'certification runs OS and exact gateway/worker artifacts',
  cert.includes('value: 0') &&
    jobs.includes(c.images.jarvisGateway.image) &&
    jobs.includes(c.images.jarvisWorker.image),
);
add(
  'synthetic auth is production-shaped but non-secret',
  JSON.parse(auth).mode === 'PRODUCTION' && JSON.parse(auth).operator.id === 'phase19',
);
add(
  'staging and production overlays contain no generated secrets',
  !staging.includes('secretGenerator') && !prod.includes('secretGenerator'),
);
add(
  'Kind and API-server dry-run are CI gates',
  workflow.includes(c.kubernetes.kindNodeImage) &&
    workflow.includes('--dry-run=server') &&
    workflow.includes('kubectl kustomize'),
);
add(
  'CI deploys certification overlay only',
  workflow.includes('overlays/certification') &&
    !workflow.includes('apply -k ops/kubernetes/overlays/production'),
);
add(
  'no production Kubernetes operation',
  c.nonGoals.productionCluster === true && !workflow.includes('namespace qf-jarvis-production'),
);

for (const [n, ok] of checks) console.log((ok ? 'PASS' : 'FAIL') + ' ' + n);
const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error('Jarvis Phase19 failed: ' + failed.length);
  process.exit(1);
}
console.log(
  'Jarvis Phase19 Kubernetes contract PASS (' + checks.length + '/' + checks.length + ')',
);
