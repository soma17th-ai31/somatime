import * as React from "react"

import { cn } from "@/lib/cn"

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      data-slot="input"
      type={type}
      className={cn(
        "flex h-11 w-full rounded-md border border-border bg-input px-3 py-2 text-base text-foreground shadow-[inset_0_0_0_1px_var(--border)] outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[2px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = "Input"
