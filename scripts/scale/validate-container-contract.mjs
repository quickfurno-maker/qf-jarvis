#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL("../../" + path, import.meta.url), "utf8");

const [josDocker, josCompose, gatewayDocker, gatewayCompose, workerDocker, workerCompose, aarohiCompose, aarohiReadme] = await Promise.all([
  read("deploy/jarvis-os/Dockerfile"),
  read("deploy/jarvis-os/compose.production.yml"),
  read("deploy/quickfurno-gateway/Dockerfile"),
  read("deploy/quickfurno-gateway/compose.production.yml"),
  read("deploy/quickfurno-worker/Dockerfile"),
  read("deploy/quickfurno-worker/compose.production.yml"),
  read("deploy/aarohi-phase2/compose.production.yml"),
  read("deploy/aarohi-phase2/README.md"),
]);

const allCompose = [josCompose, gatewayCompose, workerCompose, aarohiCompose];
const allDocker = [josDocker, gatewayDocker, workerDocker];
const pinnedNodeDigest = "sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d";

const checks = [
  ["all runtime Dockerfiles pin the reviewed Node digest", allDocker.every((value) => value.includes(pinnedNodeDigest))],
  ["Jarvis OS non-root", josDocker.includes("USER 10001:10001")],
  ["gateway non-root", gatewayDocker.includes("USER 10002:10002")],
  ["API worker non-root", workerDocker.includes("USER 10003:10002")],
  ["all Dockerfiles carry exact revision labels", allDocker.every((value) => value.includes("org.opencontainers.image.revision"))],
  ["all Compose roles use read-only rootfs", allCompose.every((value) => value.includes("read_only: true"))],
  ["all Compose roles drop capabilities", allCompose.every((value) => value.includes("cap_drop:"))],
  ["all Compose roles enforce no-new-privileges", allCompose.every((value) => value.includes("no-new-privileges:true"))],
  ["all Compose roles have bounded logs", allCompose.every((value) => value.includes("max-size:") && value.includes("max-file:"))],
  ["all Compose roles have resource limits", allCompose.every((value) => value.includes("resources:") && value.includes("memory:"))],
  ["private roles expose no host ports", [josCompose, gatewayCompose, workerCompose, aarohiCompose].every((value) => !/^\s*ports:/mu.test(value))],
  ["private roles stay outside Traefik until explicit ingress overlay", allCompose.every((value) => value.includes("traefik.enable: 'false'"))],
  ["no privileged container", allCompose.every((value) => !/\bprivileged\s*:\s*true\b/u.test(value))],
  ["no host network", allCompose.every((value) => !/network_mode\s*:\s*['\"]?host/u.test(value))],
  ["no Docker socket mount", allCompose.every((value) => !value.includes("/var/run/docker.sock"))],
  ["gateway durable spool remains explicit writable state", gatewayCompose.includes("/var/lib/qfj-turns") && gatewayCompose.includes("read_only: false")],
  ["WhatsApp worker durable spool remains explicit writable state", workerCompose.includes("/var/lib/qfj-turns") && workerCompose.includes("read_only: false")],
  ["Jarvis OS observation state is read-only", josCompose.includes("/run/observability") && josCompose.includes("read_only: true")],
  ["Aarohi reuses certified API-worker image lineage", aarohiCompose.includes("qf-jarvis-whatsapp-worker:")],
  ["Aarohi command is explicit", aarohiCompose.includes("run-aarohi-phase2-worker.js")],
  ["Aarohi secret mount is dedicated and read-only", aarohiCompose.includes("/srv/qf-jarvis/secrets/aarohi-phase2") && aarohiCompose.includes("read_only: true")],
  ["Aarohi is not exposed through Traefik", aarohiCompose.includes("traefik.enable: 'false'")],
  ["Aarohi disabled mode cannot restart-loop", aarohiCompose.includes("restart: 'on-failure:5'") && aarohiReadme.includes("enabled: false")],
  ["SINGLE_OWNER scaling deferral is documented", aarohiReadme.includes("distributed scheduler ownership") || aarohiReadme.includes("horizontal agent scaling")],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
if (failed.length) {
  console.error(`Jarvis container contract failed: ${failed.length} check(s)`);
  process.exit(1);
}
console.log(`Jarvis container contract PASS (${checks.length}/${checks.length})`);