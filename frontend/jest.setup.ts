// @testing-library/react-native v12.4+ bundles jest-native matchers by
// default — no separate extend-expect import needed.
// (Required env vars and the AsyncStorage native-module mock are set up
// in jest.env.js, via setupFiles, which runs before this file's own
// imports — and any test file's hoisted imports — are evaluated.)
import { server } from './test/mocks/server';

// Plain require() rather than `import ... from 'node:http'` — this repo
// has no @types/node (it's an RN app; Node types aren't otherwise
// needed), and this file never ships in the app bundle, only runs under
// Jest's own Node process, so the module-resolution strictness that
// `import` would trigger doesn't buy anything here.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const http = require('node:http') as typeof import('node:http');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const https = require('node:https') as typeof import('node:https');

// msw/node (@mswjs/interceptors) constructs a synthetic, never-connected
// `net.Socket` per intercepted request to satisfy Node's `http.ClientRequest`
// internals (confirmed by inspecting the leaked handles directly:
// remoteAddress/localPort are both undefined and readyState is
// 'writeOnly' — these are not real network connections). MSW never calls
// `.destroy()`/`.unref()` on them, so every httpClient call in this suite
// leaves one behind, and left alone it keeps the whole `jest` process
// alive after the test summary prints (reproducible even on the single,
// pristine httpClient.test.ts file from M0, independent of anything
// added in this milestone). `http.globalAgent.destroy()` doesn't reach
// these — they aren't in the agent's pool — so the fix is to `unref()`
// any live socket directly so Node's event loop doesn't wait on it. This
// resolves the hang for plain httpClient-only test files; a test that
// also renders a React Query hook (useLogout.test.ts) has a second,
// separate leftover-timer source this couldn't pin down to a concrete
// handle, which is why `npm test` also runs with --forceExit as a
// backstop (see package.json) — tests themselves pass correctly either
// way; this is purely about the process exiting afterward.
function unrefLeakedSockets() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const net = require('node:net') as typeof import('node:net');
  const activeHandles = (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.() ?? [];
  for (const handle of activeHandles) {
    if (handle instanceof net.Socket && typeof handle.unref === 'function') {
      handle.unref();
    }
  }
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  unrefLeakedSockets();
});
afterAll(() => {
  server.close();
  http.globalAgent.destroy();
  https.globalAgent.destroy();
  unrefLeakedSockets();
});
