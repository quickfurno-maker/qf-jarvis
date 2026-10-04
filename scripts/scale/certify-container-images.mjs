#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAX_BUFFER = 128 * 1024 * 1024;
function exec(command, args, options = {}) {
  const capture = options.capture === true;
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: options.env ?? process.env,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (capture) {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
    throw new Error(`command_failed status=${String(result.status)} command=${command} ${args.join(" ")}`);
  }
  return capture ? String(result.stdout ?? "") : "";
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`PASS ${message}`);
}

const sha = (process.env.QFJ_CERT_SHA?.trim() || exec("git", ["rev-parse", "HEAD"], { capture: true }).trim());
assert(/^[0-9a-f]{40}$/u.test(sha), "exact Git SHA resolved");
exec("node", ["scripts/scale/validate-container-contract.mjs"]);

const composeEnv = {
  ...process.env,
  JOS_IMAGE_TAG: sha,
  QFJ_GATEWAY_IMAGE_TAG: sha,
  QFJ_WORKER_IMAGE_TAG: sha,
  QFJ_AAROHI_PHASE2_IMAGE_TAG: sha,
};
for (const file of [
  "deploy/jarvis-os/compose.production.yml",
  "deploy/quickfurno-gateway/compose.production.yml",
  "deploy/quickfurno-worker/compose.production.yml",
  "deploy/aarohi-phase2/compose.production.yml",
]) {
  exec("docker", ["compose", "-f", file, "config", "--quiet"], { env: composeEnv });
}
console.log("PASS production Compose models");

const images = [
  { name: `qf-jarvis-os:${sha}`, dockerfile: "deploy/jarvis-os/Dockerfile", user: "10001:10001" },
  { name: `qf-jarvis-gateway:${sha}`, dockerfile: "deploy/quickfurno-gateway/Dockerfile", user: "10002:10002" },
  { name: `qf-jarvis-whatsapp-worker:${sha}`, dockerfile: "deploy/quickfurno-worker/Dockerfile", user: "10003:10002" },
];
for (const image of images) {
  exec("docker", ["build", "-f", image.dockerfile, "--build-arg", `GIT_SHA=${sha}`, "-t", image.name, "."]);
  const user = exec("docker", ["image", "inspect", image.name, "--format", "{{.Config.User}}"], { capture: true }).trim();
  assert(user === image.user, `${image.name} fixed non-root identity`);
  const revision = exec("docker", ["image", "inspect", image.name, "--format", '{{index .Config.Labels "org.opencontainers.image.revision"}}'], { capture: true }).trim();
  assert(revision === sha, `${image.name} exact revision label`);
  exec("docker", ["run", "--rm", "--entrypoint", "sh", image.name, "-c", "! command -v npm >/dev/null 2>&1"]);
  console.log(`PASS ${image.name} excludes npm`);
}

const workerImage = `qf-jarvis-whatsapp-worker:${sha}`;
exec("docker", ["run", "--rm", "--entrypoint", "node", workerImage, "--check", "apps/api/dist/bin/run-quickfurno-whatsapp-production-worker.js"]);
exec("docker", ["run", "--rm", "--entrypoint", "node", workerImage, "--check", "apps/api/dist/bin/run-aarohi-phase2-worker.js"]);
console.log("PASS API worker executables parse on runtime Node");

const temp = mkdtempSync(join(tmpdir(), "qfj-aarohi-container-cert-"));
try {
  const configPath = join(temp, "worker.json");
  const config = {
    revision: sha,
    enabled: false,
    workerRef: "aarohi.phase2.container-certification",
    pollMs: 1000,
    core: {
      baseUrl: "https://example.invalid",
      keyId: "container-certification",
      privateKeyFile: "/run/secrets/aarohi-phase2/not-read-while-disabled.key",
      timeoutMs: 1000,
    },
    providers: [],
  };
  writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
  const mount = `${temp}:/run/secrets/aarohi-phase2:ro`;
  const output = exec("docker", [
    "run", "--rm", "--read-only",
    "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16m",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges:true",
    "--pids-limit", "128",
    "--memory", "512m",
    "--cpus", "0.5",
    "-v", mount,
    "--entrypoint", "node",
    workerImage,
    "apps/api/dist/bin/run-aarohi-phase2-worker.js",
    "--config", "/run/secrets/aarohi-phase2/worker.json",
  ], { capture: true });
  process.stdout.write(output);
  assert(output.includes("qfj-aarohi-phase2-worker DISABLED"), "Aarohi disabled role exits safely without provider access");
} finally {
  rmSync(temp, { recursive: true, force: true });
}

console.log(`Jarvis exact-head container certification PASS sha=${sha}`);