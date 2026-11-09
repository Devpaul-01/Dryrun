import React from 'react';
import type { ColorValue } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

export interface IconProps {
  color: ColorValue;
  size?: number;
}

/**
 * Small hand-drawn icon set for the tab bar — four icons only, so a full
 * icon library is unnecessary weight for M0. Stroke-based, 1.75px weight,
 * matching the "instrumented, not decorated" design principle (§theme).
 */

export function HomeIcon({ color, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 11.5 12 4l8 7.5M6 10v9h12v-9"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function TargetIcon({ color, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={8} stroke={color} strokeWidth={1.75} />
      <Circle cx={12} cy={12} r={3.5} stroke={color} strokeWidth={1.75} />
      <Circle cx={12} cy={12} r={0.75} fill={color} />
    </Svg>
  );
}

export function ClockIcon({ color, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={8} stroke={color} strokeWidth={1.75} />
      <Path d="M12 7.5V12l3 2" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function TrendIcon({ color, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 16l5-5 3.5 3.5L20 7"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M14.5 7H20v5.5" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
