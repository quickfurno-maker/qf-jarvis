#!/usr/bin/env node
import { runOpenAILaunchSmokeCli } from '../cli/run-openai-launch-smoke.js';

try {
  await runOpenAILaunchSmokeCli(process.argv.slice(2), {
    out: (line) => process.stdout.write(line),
  });
} catch {
  process.stderr.write('OPENAI_LAUNCH_SMOKE=FAIL\n');
  process.exitCode = 1;
}
