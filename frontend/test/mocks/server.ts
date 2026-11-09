import { setupServer } from 'msw/node';

import { handlers } from './handlers';

/**
 * Jest test server (jest-expo runs Jest's Node environment, not a real
 * RN runtime, so msw/node — not msw/native — is correct here).
 * Wire into jest.setup.ts: server.listen() in beforeAll,
 * server.resetHandlers() in afterEach, server.close() in afterAll.
 */
export const server = setupServer(...handlers);
