// https://docs.expo.dev/guides/using-eslint/
const expoConfig = require('eslint-config-expo/flat');

module.exports = [
  ...expoConfig,
  {
    // The React Compiler-era hook rules flag intentional patterns here: syncing form state from
    // loaded query data, timer-driven polling state, and refs read in event callbacks. They stay
    // visible as warnings so new code is nudged, without blocking CI on reviewed existing code.
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
    },
  },
  {
    ignores: ['dist/*', 'node_modules/*', '.expo/*'],
  },
];
