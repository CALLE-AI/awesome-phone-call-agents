export type RuntimeBindings = Record<string, unknown>;

const RUNTIME_BINDINGS_KEY = Symbol.for("sparescout.runtime-bindings");

type RuntimeGlobal = typeof globalThis & {
  [RUNTIME_BINDINGS_KEY]?: RuntimeBindings;
};

export function installRuntimeBindings(bindings: RuntimeBindings): void {
  (globalThis as RuntimeGlobal)[RUNTIME_BINDINGS_KEY] = bindings;
}

export function getRuntimeBindings(): RuntimeBindings {
  const installed = (globalThis as RuntimeGlobal)[RUNTIME_BINDINGS_KEY] ?? {};
  const processBindings = typeof process === "undefined" ? {} : process.env;
  return { ...processBindings, ...installed };
}
