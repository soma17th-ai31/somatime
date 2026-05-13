import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { DayPicker } from "react-day-picker"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/cn"

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-0", className)}
      classNames={{
        root: "w-full",
        // v9 DOM: <Months> contains <Nav> (default navLayout) followed by <Month>s.
        // Putting `relative` on months lets `nav` use absolute positioning with
        // an inset anchored to the same row as the first month_caption.
        months: "relative flex flex-col gap-2",
        month: "flex w-full flex-col gap-3",
        month_caption: "flex h-10 items-center justify-center",
        caption_label: "text-sm font-semibold tracking-tight text-foreground",
        // Nav is rendered as a Months-level sibling, NOT inside month_caption.
        // Pin it to the top row of the calendar and let the buttons sit at the
        // edges; pointer-events-none on the container avoids blocking caption
        // hits while the buttons themselves opt back in.
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
        // while keeping them square. day_button stretches to fill so the row
        // stays uniform regardless of viewport.
        day: "relative flex-1 aspect-square p-0 text-center text-sm focus-within:relative focus-within:z-20",
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "h-full w-full p-0 font-medium aria-selected:opacity-100",
        ),
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
