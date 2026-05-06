import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex w-fit shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs whitespace-nowrap transition-colors', {
  variants: {
    variant: {
      default: 'border-transparent bg-primary text-primary-foreground',
      secondary: 'border-border bg-secondary text-secondary-foreground',
      outline: 'border-border text-muted-foreground',
      success: 'border-transparent bg-success/15 text-success',
    },
  },
  defaultVariants: {
    variant: 'secondary',
  },
});

function Badge({ className, variant, ...props }: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
