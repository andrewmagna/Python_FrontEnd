import { Routes, Route, Navigate } from "react-router-dom"
import PartsGrid from "./pages/PartsGrid.jsx"
import PartPage from "./pages/PartPage.jsx"
import AdminLogin from "./pages/AdminLogin.jsx"
import AdminEditor from "./pages/AdminEditor.jsx"

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<PartsGrid />} />
      <Route path="/part/:partId" element={<PartPage />} />
      <Route path="/admin/login" element={<AdminLogin />} />
      {/* <Route path="/admin/editor" element={<AdminEditor />} /> */}
      <Route path="/admin/editor/:partId/:sectionIndex" element={<AdminEditor />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}