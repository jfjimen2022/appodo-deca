import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Users, Plus, Pencil, Trash2, Loader2, ShieldCheck } from 'lucide-react'
import { usuariosService } from '../services/usuariosService'
import { useToast } from '../context/ToastContext'
import { Button } from '../components/ui/button'
import { Card, CardContent } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Checkbox } from '../components/ui/checkbox'
import { Badge } from '../components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '../components/ui/dialog'

const FORM_VACIO = {
  username: '', password: '', first_name: '', last_name: '', email: '',
  is_staff: false, is_active: true,
}

// Gestión simple de usuarios (admin-only) -- solo dos roles, ver
// decisiones de arquitectura: is_staff true (admin) / false (operador).
// No hay pantalla equivalente en el ERP origen (allí es multiempresa con
// roles/permisos granulares); esta es nueva, del standalone.
export default function UsuariosPage() {
  const { t } = useTranslation('common')
  const toast = useToast()

  const [usuarios, setUsuarios] = useState([])
  const [cargando, setCargando] = useState(true)
  const [dialogAbierto, setDialogAbierto] = useState(false)
  const [editando, setEditando] = useState(null)
  const [form, setForm] = useState(FORM_VACIO)
  const [guardando, setGuardando] = useState(false)
  const [erroresCampo, setErroresCampo] = useState({})
  const [aBorrar, setABorrar] = useState(null)
  const [borrando, setBorrando] = useState(false)

  const cargar = () => {
    setCargando(true)
    usuariosService.listar()
      .then(({ data }) => setUsuarios(data.results ?? data))
      .catch(() => toast.error(t('usuarios.error_cargar')))
      .finally(() => setCargando(false))
  }

  useEffect(() => { cargar() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const abrirAlta = () => {
    setEditando(null)
    setForm(FORM_VACIO)
    setErroresCampo({})
    setDialogAbierto(true)
  }

  const abrirEdicion = (u) => {
    setEditando(u)
    setForm({
      username: u.username, password: '', first_name: u.first_name || '',
      last_name: u.last_name || '', email: u.email || '',
      is_staff: u.is_staff, is_active: u.is_active,
    })
    setErroresCampo({})
    setDialogAbierto(true)
  }

  const handleGuardar = async () => {
    setGuardando(true)
    setErroresCampo({})
    try {
      const payload = { ...form }
      if (editando && !payload.password) delete payload.password
      if (editando) {
        await usuariosService.actualizar(editando.id, payload)
      } else {
        await usuariosService.crear(payload)
      }
      setDialogAbierto(false)
      toast.success(t('usuarios.guardado_ok'))
      cargar()
    } catch (err) {
      const datos = err.response?.data
      if (datos && typeof datos === 'object') {
        setErroresCampo(Object.fromEntries(
          Object.entries(datos).map(([k, v]) => [k, Array.isArray(v) ? v.join(' ') : String(v)]),
        ))
      }
      toast.error(t('usuarios.error_guardar'))
    } finally {
      setGuardando(false)
    }
  }

  const handleBorrar = async () => {
    if (!aBorrar) return
    setBorrando(true)
    try {
      await usuariosService.borrar(aBorrar.id)
      setABorrar(null)
      toast.success(t('usuarios.borrado_ok'))
      cargar()
    } catch {
      toast.error(t('usuarios.error_borrar'))
    } finally {
      setBorrando(false)
    }
  }

  return (
    <div className="w-full max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Users className="h-6 w-6 text-[var(--color-marca)]" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('usuarios.title')}</h1>
            <p className="text-sm text-gray-500">{t('usuarios.subtitle')}</p>
          </div>
        </div>
        <Button onClick={abrirAlta} className="gap-1.5">
          <Plus className="h-4 w-4" /> {t('usuarios.btn_nuevo')}
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {cargando ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-[var(--color-marca)]" />
            </div>
          ) : usuarios.length === 0 ? (
            <p className="text-center py-12 text-sm text-gray-400">{t('usuarios.vacio')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left font-semibold text-gray-600 px-4 py-2.5">{t('usuarios.col_usuario')}</th>
                    <th className="text-left font-semibold text-gray-600 px-4 py-2.5">{t('usuarios.col_nombre')}</th>
                    <th className="text-left font-semibold text-gray-600 px-4 py-2.5">{t('usuarios.col_email')}</th>
                    <th className="text-left font-semibold text-gray-600 px-4 py-2.5">{t('usuarios.col_rol')}</th>
                    <th className="text-right font-semibold text-gray-600 px-4 py-2.5">{t('usuarios.col_acciones')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {usuarios.map((u) => (
                    <tr key={u.id} className={u.is_active ? '' : 'opacity-50'}>
                      <td className="px-4 py-2.5 font-medium text-gray-900">{u.username}</td>
                      <td className="px-4 py-2.5 text-gray-600">{[u.first_name, u.last_name].filter(Boolean).join(' ') || '—'}</td>
                      <td className="px-4 py-2.5 text-gray-600">{u.email || '—'}</td>
                      <td className="px-4 py-2.5">
                        {u.is_staff ? (
                          <Badge className="gap-1"><ShieldCheck className="h-3 w-3" /> {t('usuarios.rol_admin')}</Badge>
                        ) : (
                          <Badge variant="secondary">{t('usuarios.rol_operador')}</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button type="button" onClick={() => abrirEdicion(u)} className="p-2 text-gray-400 hover:text-[var(--color-marca)]" aria-label={`Editar ${u.username}`}>
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button type="button" onClick={() => setABorrar(u)} className="p-2 text-gray-400 hover:text-red-600" aria-label={`Eliminar ${u.username}`}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogAbierto} onOpenChange={setDialogAbierto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editando ? t('usuarios.editar_titulo') : t('usuarios.nuevo_titulo')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="username">{t('usuarios.label_username')}</Label>
              <Input id="username" value={form.username} disabled={!!editando} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} />
              {erroresCampo.username && <p className="text-xs text-red-600">{erroresCampo.username}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">{editando ? t('usuarios.label_password_editar') : t('usuarios.label_password')}</Label>
              <Input id="password" type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
              {erroresCampo.password && <p className="text-xs text-red-600">{erroresCampo.password}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="first_name">{t('usuarios.label_nombre')}</Label>
                <Input id="first_name" value={form.first_name} onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="last_name">{t('usuarios.label_apellidos')}</Label>
                <Input id="last_name" value={form.last_name} onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">{t('usuarios.label_email')}</Label>
              <Input id="email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox checked={form.is_staff} onCheckedChange={(v) => setForm((f) => ({ ...f, is_staff: !!v }))} />
              <span className="text-sm">{t('usuarios.label_es_admin')}</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox checked={form.is_active} onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: !!v }))} />
              <span className="text-sm">{t('usuarios.label_activo')}</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogAbierto(false)}>{t('usuarios.btn_cancelar')}</Button>
            <Button onClick={handleGuardar} disabled={guardando} className="gap-1.5">
              {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('usuarios.btn_guardar')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(aBorrar)} onOpenChange={(v) => !v && setABorrar(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('usuarios.confirmar_borrado_titulo')}</DialogTitle>
            <DialogDescription>{t('usuarios.confirmar_borrado_desc')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setABorrar(null)} disabled={borrando}>{t('usuarios.btn_cancelar')}</Button>
            <Button variant="destructive" onClick={handleBorrar} disabled={borrando} className="gap-2">
              {borrando && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('usuarios.btn_borrar')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
