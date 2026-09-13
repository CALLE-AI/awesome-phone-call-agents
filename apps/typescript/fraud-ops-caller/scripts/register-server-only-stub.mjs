import Module from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const stub = fileURLToPath(new URL("./server-only-stub.cjs", import.meta.url));
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function patchedResolve(request, ...args) {
  if (request === "server-only") return stub;
  return originalResolveFilename.call(this, request, ...args);
};

if (typeof Module.registerHooks === "function") {
  Module.registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") {
        return { url: pathToFileURL(stub).href, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
}
