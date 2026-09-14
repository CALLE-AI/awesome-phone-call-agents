const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

/**
 * Monorepo resolution.
 *
 * The mobile app imports the same @dial/schemas and @dial/api-client the web
 * app and the server use, so the three clients cannot drift apart on contracts.
 * Metro needs to be told to watch the workspace root and to look in both
 * node_modules trees for that to work.
 */
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// Hierarchical lookup is deliberately left ON: Expo's own packages import
// transitive deps (expo-asset, expo-font) that live nested rather than hoisted,
// and disabling it makes those unresolvable.
module.exports = config;
