import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

// Solo is_staff=true (admin) puede entrar -- Configuración de DeCa y
// gestión de Usuarios. Un operador que navegue a mano a estas rutas
// vuelve a Expediciones, no ve ni siquiera un mensaje de error.
export default function AdminRoute() {
  const { user, loading, isAdmin } = useAuth()

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-gray-400 text-sm">
        Cargando...
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />
  if (!isAdmin) return <Navigate to="/deca" replace />

  return <Outlet />
}
