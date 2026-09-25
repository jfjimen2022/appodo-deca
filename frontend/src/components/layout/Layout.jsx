import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Truck, Users2, Settings, Users, LogOut, Package } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { APP_VERSION, APPODO_SYNC_VERSION, APPODO_SYNC_FECHA } from '../../version'

// Shell mínimo del standalone: cabecera con el nombre de la app + nav con
// 3-4 enlaces (Expediciones, Agenda, Configuración/Usuarios si es admin) +
// logout. Nada del Sidebar/Header/BottomNav multi-módulo del ERP origen.
export default function Layout() {
  const { user, isAdmin, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  const linkClass = ({ isActive }) =>
    `flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
      isActive ? 'bg-[rgb(var(--color-marca-rgb)/0.1)] text-[var(--color-marca)]' : 'text-gray-600 hover:bg-gray-100'
    }`

  return (
    <div className="flex flex-col h-screen w-full bg-gray-50">
      <header className="shrink-0 border-b bg-white">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 font-bold text-gray-900">
            <Package className="h-5 w-5 text-[var(--color-marca)]" />
            Appodo DeCa
          </div>
          <nav className="flex items-center gap-1">
            <NavLink to="/deca" end className={linkClass}>
              <Truck className="h-4 w-4" /> <span className="hidden sm:inline">Expediciones</span>
            </NavLink>
            <NavLink to="/deca/agenda" className={linkClass}>
              <Users2 className="h-4 w-4" /> <span className="hidden sm:inline">Agenda</span>
            </NavLink>
            {isAdmin && (
              <>
                <NavLink to="/deca/configuracion" className={linkClass}>
                  <Settings className="h-4 w-4" /> <span className="hidden sm:inline">Configuración</span>
                </NavLink>
                <NavLink to="/deca/usuarios" className={linkClass}>
                  <Users className="h-4 w-4" /> <span className="hidden sm:inline">Usuarios</span>
                </NavLink>
              </>
            )}
          </nav>
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline text-sm text-gray-500">{user?.username}</span>
            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-red-600"
              aria-label="Cerrar sesión"
            >
              <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Salir</span>
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 min-h-0 overflow-y-auto p-4">
        <Outlet />
      </main>
      <footer className="shrink-0 border-t bg-white px-4 py-2 text-center">
        <div className="text-sm font-semibold text-gray-700">Appodo DeCa {APP_VERSION}</div>
        <div className="text-xs text-gray-400">
          Última sincronización con Appodo: {APPODO_SYNC_VERSION} · {APPODO_SYNC_FECHA}
        </div>
      </footer>
    </div>
  )
}
