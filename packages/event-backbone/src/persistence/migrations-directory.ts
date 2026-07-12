/**
 * Where the migration files live.
 *
 * This is its own module for a reason worth stating: the migration **CLI** executes on
 * import — that is what a CLI is. If the package's public surface imported the directory
 * helper *from* the CLI, then `import '@qf-jarvis/event-backbone'` would run the CLI, and
 * importing a library would migrate a database.
 *
 * So the helper lives here, where it has no side effects, and both the CLI and the public
 * surface import it from a module that does nothing when loaded.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * The `migrations/` directory beside this module.
 *
 * Resolved relative to the compiled output at runtime, so it is correct whether the
 * caller is running from `src` under Vitest or from `dist` under Node.
 */
export function defaultMigrationsDirectory(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'migrations');
}
