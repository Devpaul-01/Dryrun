/**
 * Combined MSW handler list for the documented API contracts
 * (architecture doc §5: "MSW (msw/native) for mocking the documented API
 * contracts in isolation"). Each domain's handlers live in their own file
 * — import and spread the new file's handlers here as later milestones
 * add domains (sessions, personas, playbooks, billing, ...).
 */

import { authHandlers } from './auth';
import { catalogHandlers } from './catalog';

export const handlers = [...authHandlers, ...catalogHandlers];
