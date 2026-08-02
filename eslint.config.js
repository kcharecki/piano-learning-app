import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules', 'playwright-report', 'test-results'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // A size ceiling that is actually enforced, rather than an aspirational
      // number in a doc that eight files quietly ignored. Blank lines and
      // comments are excluded so that explaining the music theory is never the
      // thing that pushes a file over.
      'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // The two format parsers are long because the formats are: MusicXML and SMF
    // each need their own reader plus the whole tag/event vocabulary, and
    // splitting the event loop away from the state it walks would make both
    // harder to follow, not easier. Reviewed and accepted at this size.
    files: ['src/core/notation/musicxml.ts', 'src/core/notation/midifile.ts'],
    rules: { 'max-lines': ['error', { max: 620, skipBlankLines: true, skipComments: true }] },
  },
  {
    // Tests are allowed to be long: one file per module, and the cases are the
    // documentation. Capped only to catch a file that has become a dumping ground.
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: { 'max-lines': ['error', { max: 1400, skipBlankLines: true, skipComments: true }] },
  },
  // The domain core must stay pure: no DOM, no browser APIs, no framework.
  // This rule is the automated enforcement of the architecture boundary
  // described in CLAUDE.md; it is what keeps the `core` test suite fast.
  {
    files: ['src/core/**/*.ts'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'src/core must be pure — no DOM. Put this in src/adapters.' },
        { name: 'document', message: 'src/core must be pure — no DOM. Put this in src/adapters.' },
        { name: 'navigator', message: 'src/core must be pure — no DOM. Put this in src/adapters.' },
        { name: 'localStorage', message: 'src/core must be pure — use a port interface.' },
        { name: 'indexedDB', message: 'src/core must be pure — use a port interface.' },
        { name: 'fetch', message: 'src/core must be pure — use a port interface.' },
        { name: 'performance', message: 'src/core must be pure — inject a Clock port.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'src/core must be deterministic — inject a Clock port instead of Date.now().',
        },
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'src/core must be deterministic — inject a Clock port instead of new Date().',
        },
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message: 'src/core must be deterministic — inject an Rng port instead of Math.random().',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['react', 'react-dom', 'zustand', 'idb', 'opensheetmusicdisplay'], message: 'src/core must not depend on UI/IO libraries.' },
            { group: ['@app/*', '@adapters/*'], message: 'src/core must not import from app or adapters.' },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'src/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-restricted-syntax': 'off',
      'no-restricted-globals': 'off',
      'no-restricted-imports': 'off',
    },
  },
  {
    // A disabled e2e test reports as "skipped", which reads as green forever —
    // so the proof this project relies on most can be switched off without
    // anything going red. That is not hypothetical: a roadmap-4.4b agent hit a
    // genuinely failing persistence assertion and silenced it with
    // `test.fixme(true, ...)`, leaving a spec that ran, proved nothing, and
    // reported success. If a spec cannot pass, the missing work is the task —
    // fix it, or delete the spec and say so in the roadmap. Neither is
    // something a linter can be talked out of, which is the point.
    files: ['e2e/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='test'][property.name=/^(skip|fixme|only)$/]",
          message:
            'A skipped e2e reads as green forever. Make it pass, or delete it and record why in ROADMAP.md.',
        },
        {
          selector:
            "MemberExpression[object.object.name='test'][property.name=/^(skip|fixme|only)$/]",
          message:
            'A skipped e2e reads as green forever. Make it pass, or delete it and record why in ROADMAP.md.',
        },
      ],
    },
  },
)
