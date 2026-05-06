import { useEffect, type ReactNode } from "react"
import { cn } from "@/lib/cn"

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
  className?: string
  labelledBy?: string
}

export function Dialog({ open, onOpenChange, children, className, labelledBy }: DialogProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false)
    }
    window.addEventListener("keydown", onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onOpenChange])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-foreground/40 backdrop-blur-[2px]"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={cn(
          "surface-edge relative z-10 w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-2xl",
          className,
        )}
      >
        {children}
      </div>
    </div>
  )
}

export function DialogTitle({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2
      id={id}
      className="font-display text-xl font-semibold tracking-[-0.4px] text-foreground"
    >
      {children}
    </h2>
  )
}

export function DialogDescription({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-sm leading-6 text-muted-foreground">{children}</p>
}

export function DialogFooter({ children }: { children: ReactNode }) {
  return <div className="mt-6 flex justify-end gap-2">{children}</div>
}
