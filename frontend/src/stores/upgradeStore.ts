import { create } from 'zustand';

import type { FeatureGateError } from '@/types/api';

/**
 * The feature-gate (HTTP 402) that triggered the upgrade sheet. httpClient sets it
 * for every 402 anywhere in the app, so a single sheet in the root layout
 * covers session start, playbook generation and document personas alike.
 */
interface UpgradeState {
  gate: FeatureGateError | null;
  show: (gate: FeatureGateError) => void;
  dismiss: () => void;
}

export const useUpgradeStore = create<UpgradeState>((set) => ({
  gate: null,
  show: (gate) => set({ gate }),
  dismiss: () => set({ gate: null }),
}));
