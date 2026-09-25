import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ShieldCheck, Bell, Save, Loader2, Building2, FileSignature,
} from 'lucide-react'
import { decaService } from '../../services/decaService'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Switch } from '../../components/ui/switch'
import { Checkbox } from '../../components/ui/checkbox'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../components/ui/select'
import { useToast } from '../../context/ToastContext'

// TODO(standalone): en el ERP origen esta pantalla incluía una tarjeta de
// "Repositorio y custodia legal" que conectaba con Google Drive de la
// empresa (OAuth gestionado en Mi Cuenta, selector de carpeta con Google
// Picker) para guardar una copia de cada DeCA generado. Esa integración es
// específica del ERP multiempresa (credenciales de la empresa, `Empresa`
// como entidad) y se ha eliminado por completo aquí -- no hay conexión a
// Drive ni a ningún otro repositorio externo en este standalone. Si se
// quiere custodia legal fuera del propio servidor, hay que implementarla
// de cero (ver README del proyecto).

const CONFIG_VACIA = {
  rol_habitual: 'cargador',
  dias_visibilidad_publica: 10,
  dias_retencion_ip_eventos: 365,
  canal_notificacion_conductor: 'email',
  notificar_cliente_activo: false,
  canal_notificacion_cliente: 'email',
  notificar_transportista_activo: false,
  canal_notificacion_transportista: 'email',
  informe_mostrar_cabecera: false,
  informe_codigo_documento: '',
  informe_version: '',
  informe_edicion: '',
  informe_preparado_por: '',
  informe_autorizado_por: '',
}

const DIAS_VISIBILIDAD_MINIMO = 7

function SelectorCanal({ id, value, onChange, disabled, t }) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} className="w-full sm:w-48">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="email">{t('configuracion.canal_email')}</SelectItem>
        <SelectItem value="sms">{t('configuracion.canal_sms')}</SelectItem>
        <SelectItem value="whatsapp">{t('configuracion.canal_whatsapp')}</SelectItem>
      </SelectContent>
    </Select>
  )
}

export default function ConfiguracionDecaPage() {
  const { t } = useTranslation('deca')
  const toast = useToast()

  const [config, setConfig] = useState(CONFIG_VACIA)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    decaService.obtenerConfiguracion()
      .then(({ data }) => setConfig({ ...CONFIG_VACIA, ...data }))
      .catch(() => setError(t('configuracion.error_cargar')))
      .finally(() => setLoading(false))
  }, [t])

  const set = (campo, valor) => setConfig((c) => ({ ...c, [campo]: valor }))

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      const payload = {
        ...config,
        dias_visibilidad_publica: Math.max(DIAS_VISIBILIDAD_MINIMO, Number(config.dias_visibilidad_publica) || DIAS_VISIBILIDAD_MINIMO),
        dias_retencion_ip_eventos: Math.max(0, Number(config.dias_retencion_ip_eventos) || 0),
      }
      const { data } = await decaService.actualizarConfiguracion(payload)
      setConfig({ ...CONFIG_VACIA, ...data })
      toast.success(t('configuracion.guardado_ok'))
    } catch {
      setError(t('configuracion.error_guardar'))
      toast.error(t('configuracion.error_guardar'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--color-marca)]" />
      </div>
    )
  }

  return (
    <div className="w-full max-w-3xl lg:max-w-6xl xl:max-w-7xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('configuracion.title')}</h1>
        <p className="text-sm text-gray-500 mt-1">{t('configuracion.subtitle')}</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-3 text-sm">{error}</div>
      )}

      {/* El DeCA lo tienen que formalizar los DOS lados (Orden FOM/2861/2012
          art. 4, responsabilidad solidaria en el art. 7), así que el módulo
          lo usan tanto quien expide la mercancía como quien la transporta.
          Sin este ajuste se asumía siempre "cargador". */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4 text-[var(--color-marca)]" /> {t('configuracion.tarjeta_rol', 'Papel de tu empresa')}
          </CardTitle>
          <CardDescription>
            {t('configuracion.tarjeta_rol_desc', 'Qué eres normalmente en tus expediciones. Decide en qué campo se precarga tu propio NIF y cómo se reparten los NIF que lee la extracción automática. Siempre puedes corregirlo a mano en una expedición concreta.')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5 max-w-md">
            <Label htmlFor="rol_habitual" className="text-sm text-gray-700">
              {t('configuracion.label_rol_habitual', 'Mi empresa actúa normalmente como')}
            </Label>
            <Select value={config.rol_habitual} onValueChange={(v) => set('rol_habitual', v)}>
              <SelectTrigger id="rol_habitual" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cargador">
                  {t('configuracion.rol_cargador', 'Cargador — expido mercancía propia')}
                </SelectItem>
                <SelectItem value="transportista">
                  {t('configuracion.rol_transportista', 'Transportista — transporto mercancía de terceros')}
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-500">
              {t('configuracion.ayuda_rol_habitual', 'La obligación de emitir el DeCA es de los dos a la vez: el cargador contractual y el transportista efectivo responden solidariamente si falta.')}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[var(--color-marca)]" /> {t('configuracion.tarjeta_acceso_publico')}
            </CardTitle>
            <CardDescription>{t('configuracion.tarjeta_acceso_publico_desc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="dias_visibilidad" className="text-sm text-gray-700">
                {t('configuracion.label_dias_visibilidad')}
              </Label>
              <Input
                id="dias_visibilidad"
                type="number"
                min={DIAS_VISIBILIDAD_MINIMO}
                value={config.dias_visibilidad_publica}
                onChange={(e) => set('dias_visibilidad_publica', e.target.value)}
                className="w-32"
              />
              <p className="text-xs text-gray-500">{t('configuracion.ayuda_dias_visibilidad')}</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="dias_retencion" className="text-sm text-gray-700">
                {t('configuracion.label_dias_retencion_ip')}
              </Label>
              <Input
                id="dias_retencion"
                type="number"
                min={0}
                value={config.dias_retencion_ip_eventos}
                onChange={(e) => set('dias_retencion_ip_eventos', e.target.value)}
                className="w-32"
              />
              <p className="text-xs text-gray-500">{t('configuracion.ayuda_dias_retencion_ip')}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Bell className="h-4 w-4 text-[var(--color-marca)]" /> {t('configuracion.tarjeta_notificaciones')}
            </CardTitle>
            <CardDescription>{t('configuracion.tarjeta_notificaciones_desc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-3 rounded-lg border border-gray-100 bg-gray-50/70 space-y-2">
              <p className="text-sm font-medium text-gray-900">{t('configuracion.bloque_conductor')}</p>
              <p className="text-xs text-gray-500">{t('configuracion.bloque_conductor_desc')}</p>
              <SelectorCanal
                id="canal_conductor"
                value={config.canal_notificacion_conductor}
                onChange={(v) => set('canal_notificacion_conductor', v)}
                t={t}
              />
            </div>

            <div className="p-3 rounded-lg border border-gray-100 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">{t('configuracion.bloque_cliente')}</p>
                  <p className="text-xs text-gray-500">{t('configuracion.bloque_cliente_desc')}</p>
                </div>
                <Switch
                  checked={config.notificar_cliente_activo}
                  onCheckedChange={(v) => set('notificar_cliente_activo', v)}
                />
              </div>
              {config.notificar_cliente_activo && (
                <SelectorCanal
                  id="canal_cliente"
                  value={config.canal_notificacion_cliente}
                  onChange={(v) => set('canal_notificacion_cliente', v)}
                  t={t}
                />
              )}
            </div>

            <div className="p-3 rounded-lg border border-gray-100 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">{t('configuracion.bloque_transportista')}</p>
                  <p className="text-xs text-gray-500">{t('configuracion.bloque_transportista_desc')}</p>
                </div>
                <Switch
                  checked={config.notificar_transportista_activo}
                  onCheckedChange={(v) => set('notificar_transportista_activo', v)}
                />
              </div>
              {config.notificar_transportista_activo && (
                <SelectorCanal
                  id="canal_transportista"
                  value={config.canal_notificacion_transportista}
                  onChange={(v) => set('canal_notificacion_transportista', v)}
                  t={t}
                />
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Cabecera de documento controlado -- aplica al PDF de Expediciones y
          al de la Agenda (mismos 6 campos, ConfiguracionDeca.informe_*,
          compartidos entre ambos informes). */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <FileSignature className="h-4 w-4 text-[var(--color-marca)]" /> {t('configuracion.tarjeta_cabecera', 'Cabecera de documento controlado')}
          </CardTitle>
          <CardDescription>
            {t('configuracion.tarjeta_cabecera_desc', 'Opcional: añade una cabecera tipo sistema de calidad (código, versión, edición...) a los PDF exportados de Expediciones y Agenda, en vez del título simple.')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 p-2.5 rounded-lg border border-gray-100 bg-gray-50/70 cursor-pointer max-w-md">
            <Checkbox
              checked={config.informe_mostrar_cabecera}
              onCheckedChange={(v) => set('informe_mostrar_cabecera', !!v)}
            />
            <span className="text-sm font-medium text-gray-900">
              {t('configuracion.label_mostrar_cabecera', 'Mostrar cabecera de documento controlado')}
            </span>
          </label>

          {config.informe_mostrar_cabecera && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div className="space-y-1.5">
                <Label className="text-xs text-gray-500">{t('configuracion.label_codigo_documento', 'Código de documento')}</Label>
                <Input value={config.informe_codigo_documento} onChange={(e) => set('informe_codigo_documento', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-gray-500">{t('configuracion.label_version_documento', 'Versión')}</Label>
                <Input value={config.informe_version} onChange={(e) => set('informe_version', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-gray-500">{t('configuracion.label_edicion_documento', 'Edición')}</Label>
                <Input value={config.informe_edicion} onChange={(e) => set('informe_edicion', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-gray-500">{t('configuracion.label_preparado_por', 'Preparado por')}</Label>
                <Input value={config.informe_preparado_por} onChange={(e) => set('informe_preparado_por', e.target.value)} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs text-gray-500">{t('configuracion.label_autorizado_por', 'Autorizado por')}</Label>
                <Input value={config.informe_autorizado_por} onChange={(e) => set('informe_autorizado_por', e.target.value)} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* TODO(standalone): tarjeta "Repositorio y custodia legal" (Google
          Drive) del ERP origen eliminada aquí -- ver comentario al inicio
          del archivo. Si se necesita custodia legal externa del DeCA
          generado, implementarla de cero (ej. copia a S3/almacenamiento
          propio) en vez de reintroducir el flujo OAuth de Drive, que
          dependía de credenciales de empresa que no existen en este
          backend standalone. */}

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? t('configuracion.btn_guardando') : t('configuracion.btn_guardar')}
        </Button>
      </div>
    </div>
  )
}
