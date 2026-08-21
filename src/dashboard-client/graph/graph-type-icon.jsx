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

export function GraphTypeIcon({ node, color, emphasized = false, background, variant = 'ring' }) {
  const Icon = ICONS[getGraphTypeIconName(node.type)] || Shapes;
  const bare = variant === 'bare' || variant === 'solid';
  const radius = node.radius * (emphasized ? 1.92 : 1.7);
  const iconSize = radius * (bare ? 1.46 : 1.18);
  const solid = variant === 'solid';
  return (
    <>
      {emphasized && !bare ? (
        <circle
          cx={node.x}
          cy={node.y}
          r={radius * 1.38}
          fill="none"
          stroke={color}
          strokeOpacity="0.28"
          strokeWidth="1"
        />
      ) : null}
      {renderIconFrame({ variant, node, radius, color, background, emphasized })}
      <Icon
        x={node.x - iconSize / 2}
        y={node.y - iconSize / 2}
        width={iconSize}
        height={iconSize}
        color={color}
        fill={solid ? color : 'none'}
        strokeWidth={solid ? (emphasized ? 3.8 : 3.25) : (emphasized ? 2.35 : 2)}
        aria-hidden="true"
      />
    </>
  );
}

function renderIconFrame({ variant, node, radius, color, background, emphasized }) {
  if (variant === 'bare' || variant === 'solid') return null;
  if (variant === 'hex') {
    return (
      <path
        d={hexPath(node.x, node.y, radius * 1.04)}
        fill={background}
        fillOpacity="0.7"
        stroke={color}
        strokeOpacity={emphasized ? '0.9' : '0.58'}
        strokeWidth={emphasized ? '1.15' : '0.65'}
      />
    );
  }
  const soft = variant === 'soft';
  return (
    <circle
      cx={node.x}
      cy={node.y}
      r={radius}
      fill={background}
      fillOpacity={soft ? '0.34' : '0.86'}
      stroke={color}
      strokeOpacity={soft ? (emphasized ? '0.72' : '0.34') : '1'}
      strokeWidth={soft ? (emphasized ? '0.95' : '0.55') : (emphasized ? '1.7' : '1.15')}
    />
  );
}

function hexPath(x, y, radius) {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = -Math.PI / 2 + index * Math.PI / 3;
    return `${index ? 'L' : 'M'} ${x + Math.cos(angle) * radius} ${y + Math.sin(angle) * radius}`;
  }).join(' ') + ' Z';
}
