// Lightweight section header used between meeting-page sections (가용 시간
// 입력, 타임테이블 등). Bold label + optional muted hint underneath.

interface Props {
  children: React.ReactNode
  hint?: React.ReactNode
}

export function SectionTitle({ children, hint }: Props) {
  return (
    <div className="mb-3">
      <div className="text-[15px] font-bold tracking-tight text-foreground">{children}</div>
      {hint ? <div className="mt-0.5 text-[12.5px] text-muted-foreground">{hint}</div> : null}
    </div>
  )
}
