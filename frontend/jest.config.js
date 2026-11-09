const jestExpoPreset = require('jest-expo/jest-preset');

/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFiles: ['<rootDir>/jest.env.js'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  transform: {
    ...jestExpoPreset.transform,
    // jest-expo's own transform only matches .js/.jsx/.ts/.tsx — MSW's
    // dependency chain (@mswjs/interceptors -> rettime) ships ESM-only
    // .mjs with no CJS build at all, so without this entry Jest's CJS
    // require() can't load it regardless of transformIgnorePatterns.
    '^.+\\.mjs$': 'babel-jest',
  },
  transformIgnorePatterns: [
    'node_modules/(?!' +
      '((jest-)?react-native|@react-native(-community)?)|' +
      'expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|' +
      'react-navigation|@react-navigation/.*|' +
      '@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|' +
      // MSW's dependency cluster ships ESM-only (.mjs, no CJS build) —
      // every package in it needs to be transformable, not just msw
      // itself, since Jest's CJS require() can't load any of them as-is.
      'msw|@mswjs/.*|@open-draft/.*|headers-polyfill|outvariant|' +
      'strict-event-emitter|is-node-process|rettime|until-async' +
      ')',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
