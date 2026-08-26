import React from 'react';
import {
  Archive,
  BookOpen,
  Box,
  BrainCircuit,
  Building2,
  CalendarDays,
  CircleDot,
  CloudMoon,
  Compass,
  FolderKanban,
  Handshake,
  HeartPulse,
  Inbox,
  Landmark,
  Lightbulb,
  ListChecks,
  MoonStar,
  PenLine,
  Settings2,
  Shapes,
  ShieldCheck,
  Sparkles,
  UserRound,
  Workflow,
} from 'lucide-react';

import { getGraphTypeIconName } from './type-icons.js';

const ICONS = {
  Archive,
  BookOpen,
  Box,
  BrainCircuit,
  Building2,
  CalendarDays,
  CircleDot,
  CloudMoon,
  Compass,
  FolderKanban,
  Handshake,
  HeartPulse,
  Inbox,
  Landmark,
  Lightbulb,
  ListChecks,
  MoonStar,
  PenLine,
  Settings2,
  Shapes,
  ShieldCheck,
  Sparkles,
  UserRound,
  Workflow,
};

export function GraphTypeIcon({ node, color, emphasized = false, background, nodeFill = 'outline', iconStyle = 'outline' }) {
  if (iconStyle === 'none') return null;
  const Icon = ICONS[getGraphTypeIconName(node.type)] || Shapes;
  const radius = node.radius * (emphasized ? 1.72 : 1.52);
  const iconSize = radius * 1.22;
  const solid = iconStyle === 'solid';
  const iconColor = nodeFill === 'solid' ? background : color;
  return (
    <Icon
      x={node.x - iconSize / 2}
      y={node.y - iconSize / 2}
      width={iconSize}
      height={iconSize}
      color={iconColor}
      fill={solid ? iconColor : 'none'}
      strokeWidth={solid ? (emphasized ? 3.5 : 3) : (emphasized ? 2.15 : 1.85)}
      aria-hidden="true"
    />
  );
}
