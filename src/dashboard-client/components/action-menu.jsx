import React, { useRef } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { MoreHorizontal, Loader2 } from 'lucide-react';

export function ActionMenu({ label, items, disabled, pending }) {
  const dialogOpening = useRef(false);
  return <DropdownMenu.Root modal={false} onOpenChange={open => { if (open) dialogOpening.current = false; }}>
    <DropdownMenu.Trigger asChild>
      <button type="button" className="graph-button deal-icon-action" aria-label={label} title="More actions" disabled={disabled || pending} aria-busy={pending || undefined}>
        {pending ? <Loader2 size={16} className="is-spinning" aria-hidden="true" /> : <MoreHorizontal size={16} aria-hidden="true" />}
      </button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content className="action-menu-content" align="end" sideOffset={6} collisionPadding={8} onCloseAutoFocus={event => { if (dialogOpening.current) event.preventDefault(); }}>
        {items.map(({ label: itemLabel, Icon, onSelect, opensDialog, disabled: itemDisabled }) => <DropdownMenu.Item key={itemLabel} className="action-menu-item" onSelect={() => { dialogOpening.current = !!opensDialog; onSelect?.(); }} disabled={itemDisabled}>
          {Icon ? <Icon size={15} aria-hidden="true" /> : null}{itemLabel}
        </DropdownMenu.Item>)}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>;
}
