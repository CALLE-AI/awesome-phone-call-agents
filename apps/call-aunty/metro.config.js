const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

function escapePath(filePath) {
  return filePath.replace(/[/\\]/g, "[/\\\\]");
}

function mergeBlockList(existing, extra) {
  const current = existing == null ? [] : Array.isArray(existing) ? existing : [existing];
  return [...current, ...extra];
}

// Keep Metro inside the Expo app. The parent folder is not a JS workspace, and
// watching sibling Node packages (call-e-integrations-enhanced) breaks Expo.
config.projectRoot = projectRoot;
config.watchFolders = [projectRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];
config.resolver.disableHierarchicalLookup = true;
config.resolver.blockList = mergeBlockList(config.resolver.blockList, [
  new RegExp(`${escapePath(path.resolve(projectRoot, "dist"))}.*`),
  new RegExp(`${escapePath(path.resolve(workspaceRoot, "call-e-integrations-enhanced"))}.*`),
]);

module.exports = withNativeWind(config, {
  input: "./global.css",
});
