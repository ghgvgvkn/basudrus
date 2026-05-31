// Metro bundler config — Expo SDK 54 / expo-router 6.
//
// expo-router 6 imports 'expo-router/entry-classic' from inside the
// expo-router package itself. Metro 0.83 changed how it handles self-
// referencing package imports, so this sub-path fails to resolve even
// though the file exists. We explicitly alias it to the real path so
// Metro always finds it regardless of resolver version.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  'expo-router/entry-classic': path.resolve(
    __dirname,
    'node_modules/expo-router/entry-classic.js',
  ),
};

module.exports = config;
