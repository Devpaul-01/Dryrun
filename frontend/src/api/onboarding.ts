import { httpClient } from '@/api/httpClient';
import type { SuccessMessageResponse } from '@/types/auth';
import type { OnboardingStatusResponse } from '@/types/dashboard';
import type { InstantSetupRequest } from '@/types/requests';

export function getOnboardingStatus() {
  return httpClient.get<OnboardingStatusResponse>('/onboarding/status').then((res) => res.data);
}

export function instantSetup(body: InstantSetupRequest) {
  return httpClient
    .post<SuccessMessageResponse>('/onboarding/instant-setup', body)
    .then((res) => res.data);
}
