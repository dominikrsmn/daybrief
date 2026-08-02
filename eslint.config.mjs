// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const warningsOnly = (config) => {
  const configs = Array.isArray(config) ? config : [config];

  return configs.map((entry) => ({
    ...entry,
    rules: Object.fromEntries(
      Object.entries(entry.rules ?? {}).map(([ruleName, setting]) => {
        const [severity, ...options] = Array.isArray(setting)
          ? setting
          : [setting];

        if (severity === 'off' || severity === 0) {
          return [ruleName, setting];
        }

        return [ruleName, options.length > 0 ? ['warn', ...options] : 'warn'];
      }),
    ),
  }));
};

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  ...warningsOnly(eslint.configs.recommended),
  ...warningsOnly(tseslint.configs.recommendedTypeChecked),
  ...warningsOnly(eslintPluginPrettierRecommended),
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      'prettier/prettier': ['warn', { endOfLine: 'auto' }],
    },
  },
);
