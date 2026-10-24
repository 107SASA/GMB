const basePreset = require('jest-expo/jest-preset');

/** @type {import('jest').Config} */
module.exports = {
  ...basePreset,
  setupFiles: [...(basePreset.setupFiles ?? []), '<rootDir>/jest/setup.js'],
  moduleNameMapper: {
    ...basePreset.moduleNameMapper,
    '\\.css$': '<rootDir>/jest/cssStub.js',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|standard-navigation|test-renderer)',
  ],
};
