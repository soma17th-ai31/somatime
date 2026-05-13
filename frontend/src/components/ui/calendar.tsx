import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { DayPicker } from "react-day-picker"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/cn"

// v3 — Cap the calendar width so cells stay around mockup's 36-44px instead of
// stretching with the parent container, and drop the day-button's ghost
// transition so selection feedback feels immediate.
function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("mx-auto w-full max-w-[336px] p-0", className)}
      classNames={{
        root: "w-full",
        // v9 DOM: <Months> contains <Nav> (default navLayout) followed by <Month>s.
        // Putting `relative` on months lets `nav` use absolute positioning with
        // an inset anchored to the same row as the first month_caption.
        months: "relative flex flex-col gap-2",
        month: "flex w-full flex-col gap-3",
        month_caption: "flex h-10 items-center justify-center",
        caption_label: "text-sm font-semibold tracking-tight text-foreground",
        nav: "pointer-events-none absolute inset-x-0 top-0 z-[1] flex h-10 items-center justify-between px-1",
        button_previous: cn(
          buttonVariants({ variant: "outline", size: "icon" }),
          "pointer-events-auto size-8 rounded-md border-border bg-background text-[color:var(--soma-ink-soft)] hover:bg-card",
        ),
        button_next: cn(
          buttonVariants({ variant: "outline", size: "icon" }),
          "pointer-events-auto size-8 rounded-md border-border bg-background text-[color:var(--soma-ink-soft)] hover:bg-card",
        ),
        month_grid: "w-full border-collapse",
        weekdays: "flex w-full",
        weekday:
          "flex-1 py-1 text-center text-[0.78rem] font-semibold text-muted-foreground",
        week: "mt-1 flex w-full",
        // flex-1 + aspect-square spreads cells across the full container width
        // while keeping them square. Combined with the outer max-w-[336px]
        // this lands cells around ~44px on desktop and ~40px on mobile —
        // close enough to mockup's 36px without forcing a fixed pixel size.
        day: "relative flex-1 aspect-square p-0 text-center text-sm focus-within:relative focus-within:z-20",
        // Plain button (no ghost variant) so the click→fill change isn't
        // delayed by the ghost's hover transition. We keep focus-ring styling
        // for keyboard users via :focus-visible.
        day_button:
          "flex h-full w-full items-center justify-center rounded-md p-0 text-sm font-medium text-foreground outline-none transition-none hover:bg-card focus-visible:ring-2 focus-visible:ring-ring/50 aria-selected:opacity-100 disabled:pointer-events-none disabled:opacity-50",
        // Soma mockup matching. `!` flags are required because range_middle
        // and `selected` are both attached to the same day element — without
        // forcing precedence, `selected`'s bg-primary wins over the softer
        // band fill.
        selected:
          "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
        range_start:
          "rounded-l-md bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
        range_end:
          "rounded-r-md bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
        range_middle:
          "!rounded-none !bg-[var(--soma-primary-soft)] !text-primary hover:!bg-[var(--soma-primary-soft)] hover:!text-primary",
        today: "rounded-md border border-border text-foreground",
        outside: "text-muted-foreground opacity-45",
        disabled: "text-muted-foreground opacity-35",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: iconClassName }) =>
          orientation === "left" ? (
            <ChevronLeft className={cn("size-4", iconClassName)} />
          ) : (
            <ChevronRight className={cn("size-4", iconClassName)} />
          ),
      }}
      {...props}
    />
  )
}

export { Calendar }
