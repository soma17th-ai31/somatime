import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/cn"

const buttonVariants = cva(
  "inline-flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3.5 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-[2px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/85",
        secondary:
          "border border-border bg-secondary text-secondary-foreground hover:bg-secondary/80",
        outline:
          "border border-border bg-background text-foreground hover:bg-card hover:text-foreground",
        ghost: "text-foreground hover:bg-card hover:text-foreground",
        link: "h-auto px-0 text-primary underline-offset-4 hover:underline",
        destructive: "bg-destructive text-white hover:bg-destructive/90",
        // Subtle = soft brand fill (legacy callers used this for hint chips).
        subtle: "bg-primary/10 text-primary hover:bg-primary/15",
      },
      size: {
        default: "h-10 px-3.5 py-2",
        md: "h-10 px-3.5 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-11 rounded-md px-5 text-base",
        icon: "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        ref={ref as React.Ref<HTMLButtonElement>}
        type={asChild ? undefined : type}
        data-slot="button"
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    )
  },
)
Button.displayName = "Button"

export { buttonVariants }
