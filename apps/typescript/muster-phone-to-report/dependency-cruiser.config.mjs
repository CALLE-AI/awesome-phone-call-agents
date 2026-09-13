/** @type {import("dependency-cruiser").IConfiguration} */
const config = {
  forbidden: [
    {
      name: "domain-isolation",
      severity: "error",
      from: { path: "^packages/domain", pathNot: "\\.(?:test|spec)\\." },
      to: { path: "^(apps|packages/(?!domain(?:/|$)))" },
    },
    {
      name: "contracts-isolation",
      severity: "error",
      from: { path: "^packages/contracts", pathNot: "\\.(?:test|spec)\\." },
      to: { path: "^(apps|packages/(?!contracts(?:/|$)))" },
    },
    {
      name: "application-inward-only",
      severity: "error",
      from: { path: "^packages/application", pathNot: "\\.(?:test|spec)\\." },
      to: { path: "^(apps|packages/(?!domain(?:/|$)|contracts(?:/|$)|application(?:/|$)))" },
    },
    {
      name: "postgres-adapter-boundary",
      severity: "error",
      from: { path: "^packages/infrastructure-postgres", pathNot: "\\.(?:test|spec)\\." },
      to: {
        path: "^(apps|packages/(?!domain(?:/|$)|application(?:/|$)|infrastructure-postgres(?:/|$)))",
      },
    },
    {
      name: "local-evidence-adapter-boundary",
      severity: "error",
      from: { path: "^packages/infrastructure-local-evidence", pathNot: "\\.(?:test|spec)\\." },
      to: {
        path: "^(apps|packages/(?!application(?:/|$)|infrastructure-local-evidence(?:/|$)))",
      },
    },
    {
      name: "jobs-adapter-boundary",
      severity: "error",
      from: { path: "^packages/infrastructure-jobs", pathNot: "\\.(?:test|spec)\\." },
      to: {
        path: "^(apps|packages/(?!application(?:/|$)|contracts(?:/|$)|infrastructure-jobs(?:/|$)))",
      },
    },
    {
      name: "twilio-simulator-adapter-boundary",
      severity: "error",
      from: { path: "^packages/infrastructure-twilio-simulator", pathNot: "\\.(?:test|spec)\\." },
      to: {
        path: "^(apps|packages/(?!application(?:/|$)|contracts(?:/|$)|infrastructure-twilio-simulator(?:/|$)))",
      },
    },
    {
      name: "calle-adapter-boundary",
      severity: "error",
      from: { path: "^packages/infrastructure-calle", pathNot: "\\.(?:test|spec)\\." },
      to: {
        path: "^(apps|packages/(?!application(?:/|$)|infrastructure-calle(?:/|$)))",
      },
    },
    {
      name: "observability-boundary",
      severity: "error",
      from: { path: "^packages/observability", pathNot: "\\.(?:test|spec)\\." },
      to: { path: "^(apps|packages/(?!application(?:/|$)|observability(?:/|$)))" },
    },
    {
      name: "api-client-is-client-safe",
      severity: "error",
      from: { path: "^packages/api-client", pathNot: "\\.(?:test|spec)\\." },
      to: { path: "^(apps|packages/(?!api-client(?:/|$)))" },
    },
    {
      name: "web-consumes-api-client-only",
      severity: "error",
      from: { path: "^apps/web", pathNot: "\\.(?:test|spec)\\." },
      to: { path: "^(apps/(?!web(?:/|$))|packages/(?!api-client(?:/|$)))" },
    },
    {
      name: "api-binds-adapters-only-in-composition",
      severity: "error",
      from: { path: "^apps/api/src/(?!composition/)" },
      to: { path: "^packages/(infrastructure-|observability)" },
    },
    {
      name: "worker-binds-adapters-only-in-composition",
      severity: "error",
      from: { path: "^apps/worker/src/(?!composition/)" },
      to: { path: "^packages/(infrastructure-|observability)" },
    },
    {
      name: "simulator-host-binds-adapters-only-in-composition",
      severity: "error",
      from: { path: "^apps/simulator-host/src/(?!composition/)" },
      to: { path: "^packages/(infrastructure-|observability|testing)" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: "(^|/)(dist|dist-types|coverage|node_modules|generated)(/|$)",
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
  },
};

export default config;
