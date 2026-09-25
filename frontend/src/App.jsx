import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ToastProvider } from './context/ToastContext'
import PrivateRoute from './components/auth/PrivateRoute'
import AdminRoute from './components/auth/AdminRoute'
import Layout from './components/layout/Layout'
import LoginPage from './pages/LoginPage'
import UsuariosPage from './pages/UsuariosPage'
import ExpedicionesDecaPage from './pages/deca/ExpedicionesDecaPage'
import DecaFormPage from './pages/deca/DecaFormPage'
import DecaDetailPage from './pages/deca/DecaDetailPage'
import AgendaDecaPage from './pages/deca/AgendaDecaPage'
import ConfiguracionDecaPage from './pages/deca/ConfiguracionDecaPage'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            <Route element={<PrivateRoute />}>
              <Route element={<Layout />}>
                <Route path="/" element={<Navigate to="/deca" replace />} />
                <Route path="/deca" element={<ExpedicionesDecaPage />} />
                <Route path="/deca/nuevo" element={<DecaFormPage />} />
                <Route path="/deca/agenda" element={<AgendaDecaPage />} />
                <Route path="/deca/:id" element={<DecaDetailPage />} />

                <Route element={<AdminRoute />}>
                  <Route path="/deca/configuracion" element={<ConfiguracionDecaPage />} />
                  <Route path="/deca/usuarios" element={<UsuariosPage />} />
                </Route>
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/deca" replace />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
