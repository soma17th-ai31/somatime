import { Route, Routes, Link } from "react-router-dom"
import CreateMeetingPage from "./pages/CreateMeetingPage"
import MeetingPage from "./pages/MeetingPage"

function NotFoundPage() {
  return (
    <div className="linear-container flex min-h-screen flex-col items-center justify-center gap-3 text-center">
      <h1 className="font-display text-2xl font-semibold tracking-[-0.5px] text-foreground">
        페이지를 찾을 수 없습니다
      </h1>
      <p className="text-sm text-muted-foreground">
        요청하신 주소가 올바른지 확인해 주세요.
      </p>
      <Link to="/" className="text-primary underline-offset-2 hover:underline">
        회의 만들기로 돌아가기
      </Link>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<CreateMeetingPage />} />
      <Route path="/m/:slug" element={<MeetingPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
