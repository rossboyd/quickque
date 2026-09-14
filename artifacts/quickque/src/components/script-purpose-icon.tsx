import { Drama, Presentation } from 'lucide-react';
import { cn } from '@/lib/utils';

export function ScriptPurposeIcon({
  purpose,
  className,
}: {
  purpose: 'presentation' | 'performance';
  className?: string;
}) {
  const Icon = purpose === 'performance' ? Drama : Presentation;
  return <Icon aria-hidden="true" className={cn('h-4 w-4 shrink-0', className)} />;
}