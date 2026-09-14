import js from "@eslint/js";
import jsdoc from "eslint-plugin-jsdoc";

export default [
  // ---- Base recommended rules ----
  js.configs.recommended,

  // ---- JSDoc recommended + type-checking rules ----
  {
    plugins: { jsdoc },
    rules: {
      // Enforce JSDoc presence on functions
      "jsdoc/require-jsdoc": ["warn", {
        require: { FunctionDeclaration: true, ClassDeclaration: true, MethodDefinition: false },
        checkGetters: false,
        checkSetters: false,
      }],
      "jsdoc/require-description": "off",
      "jsdoc/require-param": "warn",
      "jsdoc/require-param-type": "warn",
      "jsdoc/require-param-description": "off",
      "jsdoc/require-returns": "off",
      "jsdoc/require-returns-type": "warn",
      "jsdoc/require-returns-description": "off",

      // Type-checking rules (enable + enforce)
      "jsdoc/check-param-names": "error",
      "jsdoc/check-tag-names": "off",
      "jsdoc/check-types": "off",
      "jsdoc/no-undefined-types": "off",
      "jsdoc/valid-types": "error",

      // Formatting — keep it minimal
      "jsdoc/tag-lines": "off",
    },
    settings: {
      jsdoc: {
        mode: "permissive",
        preferredTags: {
          returns: "returns",
        },
        definedTypes: ["RegExpMatchArray", "Record", "Map", "Set", "Promise", "Array"],
      },
    },
  },

  // ---- Server-side files (Node.js) ----
  {
    files: ["server.js", "demo-server.js", "authorization.js", "production-store.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        // Node.js globals
        ...Object.fromEntries([
          "Buffer", "console", "process", "setTimeout", "clearTimeout",
          "URL", "Map", "Set", "JSON", "Math", "Date", "RegExp", "Error",
          "Promise", "Object", "Array", "String", "Number", "Boolean",
          "Symbol", "parseInt", "parseFloat", "isNaN", "isFinite",
          "fetch", "crypto", "TextEncoder", "clearInterval", "setInterval", "AbortSignal",
        ].map(g => [g, "readonly"])),
        // Node.js __dirname/__filename (not available in ESM, but harmless)
        importmeta: "readonly",
      },
    },
    rules: {
      // Relax rules that are noisy for this codebase
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "preserve-caught-error": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },

  // ---- Client-side files (browser) ----
  {
    files: ["public/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        // Browser globals
        document: "readonly",
        window: "readonly",
        alert: "readonly",
        confirm: "readonly",
        fetch: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        crypto: "readonly",
        console: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        HTMLInputElement: "readonly",
        HTMLButtonElement: "readonly",
        HTMLSelectElement: "readonly",
        HTMLElement: "readonly",
        Element: "readonly",
        Event: "readonly",
        AbortController: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "preserve-caught-error": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },

  // ---- Test files ----
  {
    files: ["test/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...Object.fromEntries([
          "Buffer", "console", "process", "setTimeout", "clearTimeout",
          "URL", "Map", "Set", "JSON", "Math", "Date", "RegExp", "Error",
          "Promise", "Object", "Array", "String", "Number", "Boolean",
          "fetch", "describe", "it", "before", "after", "beforeEach",
          "afterEach", "globalThis", "document", "localStorage", "sessionStorage",
        ].map(g => [g, "readonly"])),
      },
    },
    rules: {
      "jsdoc/require-jsdoc": "off",
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "preserve-caught-error": "off",
    },
  },

  // ---- Ignore patterns ----
  {
    ignores: [
      "node_modules/**",
      ".deslop/**",
      "data/**",
      "*.py",
    ],
  },
];
