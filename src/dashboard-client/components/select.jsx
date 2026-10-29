import React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';

const EMPTY_VALUE = '__dashboard_select_empty__';

export function Select({ value, onValueChange, options, disabled = false, className = '', ...triggerProps }) {
  return (
    <SelectPrimitive.Root
      value={value === '' ? EMPTY_VALUE : value}
      onValueChange={next => onValueChange(next === EMPTY_VALUE ? '' : next)}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger className={`shadcn-select-trigger ${className}`.trim()} {...triggerProps}>
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon className="shadcn-select-icon" aria-hidden="true"><ChevronDown size={16} /></SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content className="shadcn-select-content" position="popper" sideOffset={6}>
          <SelectPrimitive.ScrollUpButton className="shadcn-select-scroll"><ChevronUp size={14} /></SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="shadcn-select-viewport">
            {options.map(option => (
              <SelectPrimitive.Item className="shadcn-select-item" key={option.value} value={option.value === '' ? EMPTY_VALUE : option.value} disabled={option.disabled}>
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="shadcn-select-check" aria-hidden="true"><Check size={14} /></SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="shadcn-select-scroll"><ChevronDown size={14} /></SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
