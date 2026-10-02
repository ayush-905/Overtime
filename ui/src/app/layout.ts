// Whether the page is in its compact layout: a phone, the Mac app's menu bar
// popover, or /mini.

import { useMedia } from '@/data/hooks';
import { inPopover } from '@/data/desktop';
import { MINI } from './router';

export function useCompact() {
  const phone = useMedia('(max-width: 720px)');
  return MINI || inPopover || phone;
}
