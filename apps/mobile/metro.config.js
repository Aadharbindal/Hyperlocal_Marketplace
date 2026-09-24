// Monorepo-aware Metro config (DECISIONS.md D-002).
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// `disableHierarchicalLookup` used to be the standard monorepo workaround. Expo's own config now
// handles workspace resolution, and turning it off fights that - expo-doctor flags it. The
// explicit nodeModulesPaths above are enough.
module.exports = config;
