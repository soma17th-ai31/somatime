import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { cn } from "@/lib/cn"

type ToastVariant = "default" | "success" | "error"

interface ToastItem {
  id: number
  message: string
  variant: ToastVariant
}

interface ToastContextValue {
  toast: (message: string, variant?: ToastVariant) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const idRef = useRef(0)

  const toast = useCallback((message: string, variant: ToastVariant = "default") => {
    idRef.current += 1
    const id = idRef.current
    setToasts((prev) => [...prev, { id, message, variant }])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 3500)
  }, [])

  const value = useMemo(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex w-full max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "surface-edge pointer-events-auto rounded-md border px-4 py-3 text-sm shadow-lg",
              t.variant === "error" && "border-destructive/40 bg-destructive/10 text-destructive",
              t.variant === "success" && "border-success/40 bg-success/15 text-success",
              t.variant === "default" && "border-border bg-card text-card-foreground",
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error("useToast must be used within ToastProvider")
  return ctx
}
