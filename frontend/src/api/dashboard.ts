import { httpClient } from '@/api/httpClient';
import type { DashboardResponse } from '@/types/dashboard';

export function getDashboard() {
  return httpClient.get<DashboardResponse>('/dashboard').then((res) => res.data);
}
