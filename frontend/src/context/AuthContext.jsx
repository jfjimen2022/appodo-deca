import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { authService } from '../services/authService'
import { limpiarCacheDeca } from '../lib/decaOffline'

// Auth standalone: SIN multi-tenant (no hay selector de empresa). El usuario
// autenticado tiene username/email/is_staff -- is_staff decide si ve
// Configuración y gestión de Usuarios (admin) o solo Expediciones/Agenda
// (operador). `empresa` es la empresa ÚNICA de la instalación que devuelve
// /auth/me/ (id fijo, nombre y NIF del .env): se expone con el mismo nombre
// que en el ERP origen para que el código de DeCA (caché offline por empresa
// y usuario, precarga del NIF propio) funcione igual.
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
    // La copia de agenda/configuración guardada para trabajar sin cobertura
    // es de ESTE usuario: se borra al salir para que otra persona que use el
    // mismo móvil no la vea. La cola de DeCA pendientes NO se toca: son
    // documentos que ya viajaron en papel y deben llegar al servidor.
    limpiarCacheDeca().catch(() => {})
    setUser(null)
    localStorage.removeItem('user')
  }

  return (
    <AuthContext.Provider value={{ user, empresa: user?.empresa ?? null, loading, isAdmin: !!user?.is_staff, login, logout, recargarUsuario: cargarUsuario }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}
