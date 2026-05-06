import * as React from "react"

import { cn } from "@/lib/cn"

export const Checkbox = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    type="checkbox"
    data-slot="checkbox"
    className={cn(
      "h-4 w-4 rounded border border-border bg-input text-primary accent-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
      className,
    )}
    {...props}
  />
))
Checkbox.displayName = "Checkbox"
