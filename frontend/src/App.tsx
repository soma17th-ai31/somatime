import { Route, Routes, Link } from "react-router-dom"
import CreateMeetingPage from "./pages/CreateMeetingPage"
import MeetingPage from "./pages/MeetingPage"

function NotFoundPage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center p-8 text-center">
      <h1 className="text-2xl font-semibold text-slate-900">페이지를 찾을 수 없습니다</h1>
      <p className="mt-2 text-slate-600">요청하신 주소가 올바른지 확인해 주세요.</p>
      <Link to="/" className="mt-6 text-accent underline">
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
