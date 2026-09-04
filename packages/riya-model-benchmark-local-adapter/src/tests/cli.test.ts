/**
 * The CLI: what it refuses, what it prints, and what it writes.
 *
 * The dry-run specs are the load-bearing ones. Almost every mistake in a benchmark run lives in the
 * plan or the configuration, and a CLI that only found them after occupying a GPU for ten minutes is a
 * CLI whose checks get skipped.
 *
 * The one end-to-end spec runs the whole path -- CLI, loopback transport, engine tokenizer, adapter,
 * RMB-B scheduler, RMB-A evidence, artifact writer -- against an ephemeral OpenAI-shaped server on
 * 127.0.0.1. No model, no download, no engine, and nothing leaves the machine.
 */
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  runRiyaLocalBenchmarkCli,
  RIYA_LOCAL_EXIT_OK,
  RIYA_LOCAL_EXIT_RUNNER_FAILURE,
  RIYA_LOCAL_EXIT_USAGE,
} from '../cli/local-benchmark.js';
import {
  RIYA_LOCAL_RESULT_SET_FILENAME,
  RIYA_LOCAL_RUN_MANIFEST_FILENAME,
} from '../service/artifact-writer.js';
import { SYNTHETIC_LOCAL_BENCHMARK_INSTANT } from '../testing/fakes.js';
import { FIXTURE_MODEL_ID, fixtureConfigInput, fixturePlan } from './fixtures.js';

let server: Server | undefined;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  if (server !== undefined) {
    const closing = server;
    server = undefined;
    closing.closeAllConnections();
    closing.close();
    await once(closing, 'close');
  }
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function scratch(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'riya-local-benchmark-'));
  temporaryDirectories.push(directory);
  return directory;
}

interface Written {
  readonly lines: string[];
  readonly write: (line: string) => void;
}

function collector(): Written {
  const lines: string[] = [];
  return {
    lines,
    write: (line: string) => {
      lines.push(line);
    },
  };
}

/** Write a plan and a config to disk and return their paths. */
async function fixtureFiles(options: {
  readonly directory: string;
  readonly plan?: unknown;
  readonly config?: unknown;
}): Promise<{ readonly planPath: string; readonly configPath: string }> {
  const planPath = join(options.directory, 'plan.json');
  const configPath = join(options.directory, 'config.json');
  await writeFile(planPath, JSON.stringify(options.plan ?? fixturePlan()), 'utf8');
  await writeFile(configPath, JSON.stringify(options.config ?? fixtureConfigInput()), 'utf8');
  return { planPath, configPath };
}

/**
 * An ephemeral OpenAI-shaped server. It streams two fixed tokens and reports usage.
 *
 * It is not a model. It is a few lines of `node:http` that answer in the protocol shape, which is
 * exactly what the adapter is written against.
 */
async function startFakeEngine(options: { readonly modelId: string }): Promise<string> {
  const handler = (request: IncomingMessage, response: ServerResponse): void => {
    if (request.url?.endsWith('/models') === true) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ data: [{ id: options.modelId }] }));
      return;
    }
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('end', () => {
      if (body.includes('"stream":false')) {
        // The counting call the engine tokenizer makes.
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ model: options.modelId, usage: { prompt_tokens: 23 } }));
        return;
      }
      const event = (value: unknown): string => `data: ${JSON.stringify(value)}\n\n`;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(
        event({ model: options.modelId, choices: [{ delta: { role: 'assistant' } }] }),
      );
      response.write(event({ model: options.modelId, choices: [{ delta: { content: 'alpha' } }] }));
      response.write(event({ model: options.modelId, choices: [{ delta: { content: ' beta' } }] }));
      response.write(
        event({
          model: options.modelId,
          choices: [],
          usage: { prompt_tokens: 23, completion_tokens: 2 },
        }),
      );
      response.end('data: [DONE]\n\n');
    });
  };
  const created = createServer(handler);
  server = created;
  created.listen(0, '127.0.0.1');
  await once(created, 'listening');
  const address = created.address() as AddressInfo;
  return `http://127.0.0.1:${String(address.port)}/v1`;
}

const nowIso = (): string => SYNTHETIC_LOCAL_BENCHMARK_INSTANT;

describe('the default is safe and nothing is discovered', () => {
  it('refuses to run with no arguments at all', async () => {
    const out = collector();
    expect(await runRiyaLocalBenchmarkCli({ argv: [], write: out.write, nowIso })).toBe(
      RIYA_LOCAL_EXIT_USAGE,
    );
    expect(out.lines.join('\n')).toContain('usage:');
  });

  it('refuses to run without an endpoint', async () => {
    const directory = await scratch();
    const { planPath, configPath } = await fixtureFiles({ directory });
    const out = collector();
    expect(
      await runRiyaLocalBenchmarkCli({
        argv: ['--plan', planPath, '--config', configPath, '--artifacts', directory],
        write: out.write,
        nowIso,
      }),
    ).toBe(RIYA_LOCAL_EXIT_USAGE);
  });

  it('refuses an unknown flag rather than ignoring it', async () => {
    const out = collector();
    expect(await runRiyaLocalBenchmarkCli({ argv: ['--force'], write: out.write, nowIso })).toBe(
      RIYA_LOCAL_EXIT_USAGE,
    );
  });

  it('refuses a non-loopback endpoint before reading anything else', async () => {
    const directory = await scratch();
    const { planPath, configPath } = await fixtureFiles({ directory });
    const out = collector();
    expect(
      await runRiyaLocalBenchmarkCli({
        argv: [
          '--plan',
          planPath,
          '--config',
          configPath,
          '--endpoint',
          'https://api.example.com/v1',
          '--artifacts',
          directory,
          '--execute',
        ],
        write: out.write,
        nowIso,
      }),
    ).toBe(RIYA_LOCAL_EXIT_RUNNER_FAILURE);
    expect(out.lines).toContain('failed: ENDPOINT_NOT_LOOPBACK');
  });
});

describe('validate-only proves everything and sends nothing', () => {
  it('prints the plan it would run and writes no artifact', async () => {
    const directory = await scratch();
    const { planPath, configPath } = await fixtureFiles({ directory });
    const out = collector();
    expect(
      await runRiyaLocalBenchmarkCli({
        argv: [
          '--plan',
          planPath,
          '--config',
          configPath,
          '--endpoint',
          'http://127.0.0.1:65535',
          '--artifacts',
          join(directory, 'artifacts'),
        ],
        write: out.write,
        nowIso,
      }),
    ).toBe(RIYA_LOCAL_EXIT_OK);
    const printed = out.lines.join('\n');
    expect(printed).toContain('mode: VALIDATE_ONLY');
    expect(printed).toContain('endpoint: loopback IPV4_LOOPBACK');
    expect(printed).toContain('accelerator memory: NOT MEASURED');
    expect(printed).toContain('no request was sent');
    // Nothing was measured, so nothing was written. Even the directory does not appear.
    await expect(
      readFile(join(directory, 'artifacts', RIYA_LOCAL_RESULT_SET_FILENAME), 'utf8'),
    ).rejects.toBeDefined();
  });

  it('prints no address, no path and no prompt', async () => {
    const directory = await scratch();
    const { planPath, configPath } = await fixtureFiles({ directory });
    const out = collector();
    await runRiyaLocalBenchmarkCli({
      argv: [
        '--plan',
        planPath,
        '--config',
        configPath,
        '--endpoint',
        'http://127.0.0.1:65535',
        '--artifacts',
        directory,
      ],
      write: out.write,
      nowIso,
    });
    const printed = out.lines.join('\n').toLowerCase();
    for (const forbidden of [
      '127.0.0.1',
      'http://',
      '65535',
      'you are a synthetic',
      directory.toLowerCase(),
    ]) {
      expect(printed, forbidden).not.toContain(forbidden);
    }
  });

  it('reports the precise reason a plan and a config disagree', async () => {
    const directory = await scratch();
    const { planPath, configPath } = await fixtureFiles({
      directory,
      plan: fixturePlan({ promptProfileDigest: 'd'.repeat(64) }),
    });
    const out = collector();
    expect(
      await runRiyaLocalBenchmarkCli({
        argv: [
          '--plan',
          planPath,
          '--config',
          configPath,
          '--endpoint',
          'http://127.0.0.1:65535',
          '--artifacts',
          directory,
        ],
        write: out.write,
        nowIso,
      }),
    ).toBe(RIYA_LOCAL_EXIT_RUNNER_FAILURE);
    expect(out.lines).toContain('failed: PROMPT_PROFILE_DIGEST_MISMATCH');
  });
});

describe('an execute run, end to end, against an ephemeral local server', () => {
  it('measures, writes both artifacts and reports no selection', async () => {
    const endpoint = await startFakeEngine({ modelId: FIXTURE_MODEL_ID });
    const directory = await scratch();
    const artifacts = join(directory, 'artifacts');
    // The engine's tokenizer says 23, so the plan has to declare 23 -- which is exactly the parity the
    // adapter exists to enforce.
    const { planPath, configPath } = await fixtureFiles({
      directory,
      plan: fixturePlan({ inputTokenCount: 23, measuredRequestCount: 2, warmupRequestCount: 1 }),
    });

    const out = collector();
    const exitCode = await runRiyaLocalBenchmarkCli({
      argv: [
        '--plan',
        planPath,
        '--config',
        configPath,
        '--endpoint',
        endpoint,
        '--artifacts',
        artifacts,
        '--execute',
      ],
      write: out.write,
      nowIso,
    });
    expect(out.lines.join('\n')).toContain('served model: confirmed exact');
    expect(exitCode).toBe(RIYA_LOCAL_EXIT_OK);
    expect(out.lines.join('\n')).toContain('no model was selected');

    const resultSet = JSON.parse(
      await readFile(join(artifacts, RIYA_LOCAL_RESULT_SET_FILENAME), 'utf8'),
    ) as { readonly results: readonly { readonly observation: Record<string, number> }[] };
    expect(resultSet.results).toHaveLength(1);
    expect(resultSet.results[0]?.observation['successfulRequests']).toBe(2);
    expect(resultSet.results[0]?.observation['outputTokensTotal']).toBe(4);
    expect(resultSet.results[0]?.observation['timeToFirstTokenMicrosP50']).toBeGreaterThan(0);

    const manifest = JSON.parse(
      await readFile(join(artifacts, RIYA_LOCAL_RUN_MANIFEST_FILENAME), 'utf8'),
    ) as Record<string, unknown>;
    expect(manifest['endpointHostForm']).toBe('IPV4_LOOPBACK');
    expect(manifest['productionApproval']).toBe(false);

    // Neither artifact carries a prompt, a completion or an address.
    const both = (
      (await readFile(join(artifacts, RIYA_LOCAL_RESULT_SET_FILENAME), 'utf8')) +
      (await readFile(join(artifacts, RIYA_LOCAL_RUN_MANIFEST_FILENAME), 'utf8'))
    ).toLowerCase();
    for (const forbidden of ['alpha beta', 'you are a synthetic', '127.0.0.1', 'http://']) {
      expect(both, forbidden).not.toContain(forbidden);
    }
  });

  it('refuses to overwrite an existing artifact without being told to', async () => {
    const endpoint = await startFakeEngine({ modelId: FIXTURE_MODEL_ID });
    const directory = await scratch();
    const artifacts = join(directory, 'artifacts');
    const { planPath, configPath } = await fixtureFiles({
      directory,
      plan: fixturePlan({ inputTokenCount: 23 }),
    });
    const argv = [
      '--plan',
      planPath,
      '--config',
      configPath,
      '--endpoint',
      endpoint,
      '--artifacts',
      artifacts,
      '--execute',
    ];
    const first = collector();
    expect(await runRiyaLocalBenchmarkCli({ argv, write: first.write, nowIso })).toBe(
      RIYA_LOCAL_EXIT_OK,
    );
    const second = collector();
    expect(await runRiyaLocalBenchmarkCli({ argv, write: second.write, nowIso })).toBe(
      RIYA_LOCAL_EXIT_RUNNER_FAILURE,
    );
    expect(second.lines).toContain('failed: ARTIFACT_WRITE_REFUSED');

    const third = collector();
    expect(
      await runRiyaLocalBenchmarkCli({
        argv: [...argv, '--allow-overwrite'],
        write: third.write,
        nowIso,
      }),
    ).toBe(RIYA_LOCAL_EXIT_OK);
  });

  it('stops before measuring when the engine serves a different model', async () => {
    const endpoint = await startFakeEngine({ modelId: 'vendor.alpha/base.alpha-7' });
    const directory = await scratch();
    const { planPath, configPath } = await fixtureFiles({
      directory,
      plan: fixturePlan({ inputTokenCount: 23 }),
    });
    const out = collector();
    expect(
      await runRiyaLocalBenchmarkCli({
        argv: [
          '--plan',
          planPath,
          '--config',
          configPath,
          '--endpoint',
          endpoint,
          '--artifacts',
          join(directory, 'artifacts'),
          '--execute',
        ],
        write: out.write,
        nowIso,
      }),
    ).toBe(RIYA_LOCAL_EXIT_RUNNER_FAILURE);
    expect(out.lines).toContain('failed: ENGINE_MODEL_MISMATCH');
    await expect(
      readFile(join(directory, 'artifacts', RIYA_LOCAL_RESULT_SET_FILENAME), 'utf8'),
    ).rejects.toBeDefined();
  });

  it('reports a harness refusal under a closed code, and writes nothing', async () => {
    const endpoint = await startFakeEngine({ modelId: FIXTURE_MODEL_ID });
    const directory = await scratch();
    // The plan declares 11 input tokens; the engine's tokenizer says 23.
    const { planPath, configPath } = await fixtureFiles({
      directory,
      plan: fixturePlan({ inputTokenCount: 11 }),
    });
    const out = collector();
    expect(
      await runRiyaLocalBenchmarkCli({
        argv: [
          '--plan',
          planPath,
          '--config',
          configPath,
          '--endpoint',
          endpoint,
          '--artifacts',
          join(directory, 'artifacts'),
          '--execute',
        ],
        write: out.write,
        nowIso,
      }),
    ).toBe(RIYA_LOCAL_EXIT_RUNNER_FAILURE);
    expect(out.lines).toContain('failed: HARNESS_TARGET_CASE_MISMATCH');
  });
});
