import React from 'react';
import {
  Archive,
  BookOpen,
  Box,
  BrainCircuit,
  Building2,
  CalendarDays,
  Clapperboard,
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

import { GRAPH_TYPE_ICON_NAMES, getGraphTypeIconName } from './type-icons.js';

const ICONS = {
  Archive,
  BookOpen,
  Box,
  BrainCircuit,
  Building2,
  CalendarDays,
  Clapperboard,
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

export function PageTypeIcon({ type, size = 20 }) {
  const normalizedType = String(type || '').trim().toLowerCase();
  const Icon = GRAPH_TYPE_ICON_NAMES[normalizedType]
    ? ICONS[getGraphTypeIconName(normalizedType)]
    : Shapes;
  return <Icon size={size} strokeWidth={1.9} aria-hidden="true" />;
}

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
