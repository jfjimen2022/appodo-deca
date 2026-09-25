import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

// Redirige a /login si no hay sesión. Sin lógica de módulos/permisos
// granulares del ERP origen -- aquí solo hay sesión sí/no, y admin/operador
// (ver AdminRoute para lo segundo).
export default function PrivateRoute() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-gray-400 text-sm">
        Cargando...
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <Outlet />
}
