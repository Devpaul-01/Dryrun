// @testing-library/react-native v12.4+ bundles jest-native matchers by
// default — no separate extend-expect import needed.
// (Required env vars and the AsyncStorage native-module mock are set up
// in jest.env.js, via setupFiles, which runs before this file's own
// imports — and any test file's hoisted imports — are evaluated.)
import { server } from './test/mocks/server';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
