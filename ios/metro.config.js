const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// This project sits inside the web app's repository, whose own node_modules
// is a parent directory. Block it so the iOS bundle can never silently pick
// up the web app's copies (e.g. a second React) for something missing from
// this package.json. Nested node_modules inside ios/ still resolve normally.
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const webAppModules = new RegExp(`^${escape(path.resolve(__dirname, '../node_modules'))}/.*`);
const existing = config.resolver.blockList;
config.resolver.blockList = [
  ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
  webAppModules,
];

module.exports = withNativeWind(config, { input: './src/global.css' });
