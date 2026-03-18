import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import PartsGrid from "./pages/PartsGrid.jsx";
import PartPage from "./pages/PartPage.jsx";
import AdminLogin from "./pages/AdminLogin.jsx";
import AdminEditor from "./pages/AdminEditor.jsx";

export default function App() {
  const location = useLocation();
  const state = location.state;
  const backgroundLocation = state?.backgroundLocation;

  return (
    <>
      <Routes location={backgroundLocation || location}>
        <Route path="/" element={<PartsGrid />} />
        <Route path="/part/:partId" element={<PartPage />} />
        <Route path="/admin/editor/:partId/:sectionIndex" element={<AdminEditor />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {backgroundLocation && (
        <Routes>
          <Route path="/admin/login" element={<AdminLogin />} />
        </Routes>
      )}
    </>
  );
}