// @ts-check
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'eslint.config.js'],
  },
  {
    files: ['src/**/*.ts'],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      // tsconfig.json has noUnusedLocals/noUnusedParameters off (the
      // project's own stated choice), so don't fight that here either —
      // but still flag genuinely dead code via no-unused-vars with
      // underscore-prefixed intentional exceptions.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // This codebase deliberately uses `any` in a handful of narrow spots
      // (e.g. catching errors of unknown shape, third-party payloads
      // without types) — warn rather than error so real problems surface
      // without demanding an immediate, possibly risky, rewrite of every
      // call site in this lint-introduction commit.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
    },
  }
);
