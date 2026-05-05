import { createContext, useContext, useId, type ReactNode } from "react"
import { cn } from "@/lib/cn"

interface TabsContextValue {
  value: string
  onValueChange: (value: string) => void
  baseId: string
}

const TabsContext = createContext<TabsContextValue | null>(null)

interface TabsProps {
  value: string
  onValueChange: (value: string) => void
  children: ReactNode
  className?: string
}

export function Tabs({ value, onValueChange, children, className }: TabsProps) {
  const baseId = useId()
  return (
    <TabsContext.Provider value={{ value, onValueChange, baseId }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  )
}

function useTabsContext() {
  const ctx = useContext(TabsContext)
  if (!ctx) throw new Error("Tabs subcomponents must be inside <Tabs>")
  return ctx
}

export function TabsList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex h-10 items-center justify-start gap-1 rounded-md bg-surface-muted p-1",
        className,
      )}
    >
      {children}
    </div>
  )
}

interface TabsTriggerProps {
  value: string
  children: ReactNode
  className?: string
}

export function TabsTrigger({ value, children, className }: TabsTriggerProps) {
  const ctx = useTabsContext()
  const isActive = ctx.value === value
  const id = `${ctx.baseId}-trigger-${value}`
  const panelId = `${ctx.baseId}-panel-${value}`
  return (
    <button
      type="button"
      id={id}
      role="tab"
      aria-selected={isActive}
      aria-controls={panelId}
      tabIndex={isActive ? 0 : -1}
      onClick={() => ctx.onValueChange(value)}
      className={cn(
        "inline-flex h-8 items-center justify-center rounded px-3 text-sm font-medium transition-colors",
        isActive ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900",
        className,
      )}
    >
      {children}
    </button>
  )
}

interface TabsContentProps {
  value: string
  children: ReactNode
  className?: string
}

export function TabsContent({ value, children, className }: TabsContentProps) {
  const ctx = useTabsContext()
  if (ctx.value !== value) return null
  const id = `${ctx.baseId}-panel-${value}`
  const triggerId = `${ctx.baseId}-trigger-${value}`
  return (
    <div role="tabpanel" id={id} aria-labelledby={triggerId} className={cn("mt-4", className)}>
      {children}
    </div>
  )
}
