/**
 * Prettier configuration.
 *
 * Formatting is not a matter of taste here; it is a matter of not arguing about
 * it. These options are chosen to keep the Phase 0 documentation set readable
 * and to keep its diff small — in particular `proseWrap: "preserve"`, which
 * leaves existing prose line breaks exactly where their authors put them
 * instead of rewrapping every paragraph in the repository.
 *
 * See docs/engineering/quality-gates.md.
 *
 * @type {import("prettier").Config}
 */
export default {
  printWidth: 100,
  singleQuote: true,
  semi: true,
  trailingComma: 'all',
  arrowParens: 'always',
  endOfLine: 'lf',

  overrides: [
    {
      // Never rewrap prose. Markdown is still normalized (list markers, table
      // padding, trailing whitespace) but sentences stay on the lines they were
      // written on.
      files: ['*.md', '**/*.md'],
      options: { proseWrap: 'preserve' },
    },
    {
      // TypeScript's configuration files are JSON with comments, and the
      // comments in them are load-bearing.
      //
      // `trailingComma: none` is not cosmetic here. TypeScript tolerates a
      // trailing comma in a tsconfig, but plain `JSON.parse` does not — and
      // editors, schema validators, and CI tooling do read these files as
      // strict JSON. Inheriting the repository-wide `trailingComma: all` would
      // quietly produce a tsconfig that some tools cannot read.
      files: ['tsconfig.json', 'tsconfig.*.json', '**/tsconfig.json', '**/tsconfig.*.json'],
      options: { parser: 'jsonc', trailingComma: 'none' },
    },
  ],
};
