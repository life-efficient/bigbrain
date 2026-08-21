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

export function GraphTypeIcon({ node, color, emphasized = false, background }) {
  const Icon = ICONS[getGraphTypeIconName(node.type)] || Shapes;
  const radius = node.radius * (emphasized ? 1.92 : 1.7);
  const iconSize = radius * 1.18;
  return (
    <>
      {emphasized ? (
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
      <circle
        cx={node.x}
        cy={node.y}
        r={radius}
        fill={background}
        fillOpacity="0.86"
        stroke={color}
        strokeWidth={emphasized ? 1.7 : 1.15}
      />
      <Icon
        x={node.x - iconSize / 2}
        y={node.y - iconSize / 2}
        width={iconSize}
        height={iconSize}
        color={color}
        strokeWidth={emphasized ? 2.35 : 2}
        aria-hidden="true"
      />
    </>
  );
}
