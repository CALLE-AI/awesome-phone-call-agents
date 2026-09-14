import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/.expo/**',
      '**/android/**',
      '**/ios/**',
      'scratch/**',
      '**/*.config.*',
      'scripts/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        AbortController: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        Headers: 'readonly',
        URL: 'readonly',
        Buffer: 'readonly',
        NodeJS: 'readonly',
        RequestInit: 'readonly',
        RequestInfo: 'readonly',
        RequestCredentials: 'readonly',
        EventSource: 'readonly',
        navigator: 'readonly',
        React: 'readonly',
      },
    },
    rules: {
      // The provider payloads and drizzle's dynamic SQL genuinely need `any`
      // at the boundary; it is contained and immediately normalised.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
);
