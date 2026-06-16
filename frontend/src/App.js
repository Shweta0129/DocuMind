import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { Toaster } from "sonner";
import Layout from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import Generator from "@/pages/Generator";
import History from "@/pages/History";
import DocumentPage from "@/pages/DocumentPage";
import Reviewer from "@/pages/Reviewer";
import Templates from "@/pages/Templates";
import Settings from "@/pages/Settings";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import { ThemeProvider } from "@/lib/theme";
import { CatalogProvider } from "@/lib/catalog";
import { AuthProvider, useAuth } from "@/lib/auth";

function FullScreenLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--paper)]">
      <div className="h-10 w-40 shimmer rounded-md" />
    </div>
  );
}

function ProtectedLayout() {
  const { isAuthed, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!isAuthed) return <Navigate to="/login" replace />;
  return (
    <CatalogProvider>
      <Layout>
        <Outlet />
      </Layout>
    </CatalogProvider>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <div className="App">
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route element={<ProtectedLayout />}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/generator/:type" element={<Generator />} />
                <Route path="/history" element={<History />} />
                <Route path="/document/:id" element={<DocumentPage />} />
                <Route path="/reviewer" element={<Reviewer />} />
                <Route path="/templates" element={<Templates />} />
                <Route path="/settings" element={<Settings />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            <Toaster
              position="bottom-right"
              toastOptions={{
                style: {
                  background: "var(--surface)",
                  color: "var(--ink)",
                  border: "2px solid var(--ink)",
                  borderRadius: "12px",
                  boxShadow: "4px 4px 0 0 var(--ink)",
                  fontFamily: "DM Sans, sans-serif",
                },
              }}
            />
          </BrowserRouter>
        </div>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
