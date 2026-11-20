import { useWindowDimensions, type ViewStyle } from 'react-native';

import { layout } from '@/theme/spacing';

/** Wide content cap for the two-column tablet screens (session setup, comparison). */
export const WIDE_CONTENT_WIDTH = 1040;

/**
 * Stack `contentStyle` that centres a screen in a bounded column on large
 * screens so bubbles and forms don't stretch edge-to-edge (architecture doc
 * §9.5). The surrounding area keeps the app's canvas colour.
 */
export function contentColumn(maxWidth: number = layout.maxContentWidth): ViewStyle {
  return { width: '100%', maxWidth, alignSelf: 'center' };
}

/** True at tablet widths — screens switch to side-by-side layouts. */
export function useIsWide(): boolean {
  const { width } = useWindowDimensions();
  return width >= layout.tabletBreakpoint;
}
