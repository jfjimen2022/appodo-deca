import { useState } from 'react'
import { useNavigate, useLocation, Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Loader2, Package } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Card, CardContent } from '../components/ui/card'

export default function LoginPage() {
  const { t } = useTranslation('common')
  const { user, loading, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [entrando, setEntrando] = useState(false)
  const [error, setError] = useState('')

  // Ya hay sesión -- no tiene sentido quedarse en /login.
  if (!loading && user) {
    const destino = location.state?.from?.pathname || '/deca'
    return <Navigate to={destino} replace />
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setEntrando(true)
    try {
      await login(username, password)
      navigate(location.state?.from?.pathname || '/deca', { replace: true })
    } catch (err) {
      setError(
        err.response?.status === 401
          ? t('login.error_credenciales')
          : t('login.error_generico'),
      )
    } finally {
      setEntrando(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 px-4">
      <Card className="w-full max-w-sm">
        <CardContent className="p-6 space-y-5">
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="h-12 w-12 rounded-xl bg-[rgb(var(--color-marca-rgb)/0.1)] flex items-center justify-center">
              <Package className="h-6 w-6 text-[var(--color-marca)]" />
            </div>
            <h1 className="text-xl font-bold text-gray-900">{t('login.title')}</h1>
            <p className="text-sm text-gray-500">{t('login.subtitle')}</p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-2.5 text-sm">{error}</div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="username">{t('login.label_usuario')}</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">{t('login.label_password')}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={entrando}>
              {entrando && <Loader2 className="h-4 w-4 animate-spin" />}
              {entrando ? t('login.entrando') : t('login.btn_entrar')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
