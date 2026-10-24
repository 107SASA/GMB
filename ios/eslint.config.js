// Own flat config: without it ESLint walks up to the web app's
// eslint.config.mjs, which ignores ios/** and lints with Next.js rules.
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const globals = require('globals');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'ios/*', 'node_modules/*'],
  },
  {
    // Same project decision as the web app's eslint.config.mjs: these
    // React-Compiler / copy-style rules are not enforced in this codebase.
    rules: {
      'react/no-unescaped-entities': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    files: ['jest/**', '__tests__/**'],
    languageOptions: { globals: globals.jest },
  },
]);
