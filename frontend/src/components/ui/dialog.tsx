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
        className="absolute inset-0 bg-slate-900/50"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={cn(
          "relative z-10 w-full max-w-lg rounded-lg border border-surface-border bg-surface p-6 shadow-xl",
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
    <h2 id={id} className="text-lg font-semibold text-slate-900">
      {children}
    </h2>
  )
}

export function DialogDescription({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-sm text-slate-600">{children}</p>
}

export function DialogFooter({ children }: { children: ReactNode }) {
  return <div className="mt-6 flex justify-end gap-2">{children}</div>
}
