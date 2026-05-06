import * as React from "react"

import { cn } from "@/lib/cn"

// Native HTML <select> wrapper. Kept native (not Radix) because the create-meeting
// form drives it via react-hook-form's `register(...)` and the E1 Playwright test
// uses Page.selectOption(...). Visual styling tracks Joonggon's design tokens.
export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    data-slot="select"
    className={cn(
      "flex h-11 w-full appearance-none rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-[2px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
))
Select.displayName = "Select"
