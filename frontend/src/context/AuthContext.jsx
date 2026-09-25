import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { authService } from '../services/authService'

// Auth standalone: SIN multi-tenant (no hay 'empresa', ni selector de
// empresa). El usuario autenticado solo tiene username/email/is_staff --
// is_staff decide si ve Configuración y gestión de Usuarios (admin) o solo
// Expediciones/Agenda (operador). Ver decisiones de arquitectura del proyecto.
const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const cargarUsuario = useCallback(async () => {
    try {
      const { data } = await authService.me()
      setUser(data)
      localStorage.setItem('user', JSON.stringify(data))
    } catch {
      setUser(null)
      localStorage.removeItem('user')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Sesión vía cookie HttpOnly -- no hay token que leer en JS, así que
    // siempre hay que preguntarle al backend quién es (si la cookie no es
    // válida, /auth/me/ devuelve 401 y nos quedamos sin usuario).
    cargarUsuario()
  }, [cargarUsuario])

  const login = async (username, password) => {
    await authService.login(username, password)
    await cargarUsuario()
  }

  const logout = async () => {
    try {
      await authService.logout()
    } catch { /* aunque falle, cerramos sesión en el cliente igualmente */ }
    setUser(null)
    localStorage.removeItem('user')
  }

  return (
    <AuthContext.Provider value={{ user, loading, isAdmin: !!user?.is_staff, login, logout, recargarUsuario: cargarUsuario }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}
