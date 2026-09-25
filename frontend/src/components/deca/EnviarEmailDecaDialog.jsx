import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Send } from 'lucide-react'
import { decaService } from '../../services/decaService'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Textarea } from '../ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { useToast } from '../../context/ToastContext'

// Envío MANUAL del DeCA generado -- se escribe el destinatario en cada
// ocasión, sin automatizar nada. Compartido entre ExpedicionesDecaPage.jsx
// (listado) y DecaDetailPage.jsx (detalle) para que no se desincronicen.
export default function EnviarEmailDecaDialog({ expedicion, onOpenChange, onEnviado }) {
  const { t } = useTranslation('deca')
  const toast = useToast()
  const [form, setForm] = useState({ destinatario: '', asunto: '', cuerpo: '' })
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    if (expedicion) setForm({ destinatario: expedicion.email_conductor || '', asunto: '', cuerpo: '' })
  }, [expedicion])

  const handleEnviar = async () => {
    if (!form.destinatario.trim()) {
      toast.error(t('detalle.email_falta_destinatario', 'Escribe un email de destino.'))
      return
    }
    setEnviando(true)
    try {
      await decaService.enviarEmailExpedicion(expedicion.id, form)
      toast.success(t('detalle.email_enviado_ok', { defaultValue: 'DeCA enviado a {{destinatario}}.', destinatario: form.destinatario }))
      onOpenChange(false)
      onEnviado?.()
    } catch (err) {
      toast.error(err.response?.data?.detail || t('detalle.email_error_enviar', 'No se pudo enviar el email.'))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialog open={!!expedicion} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('detalle.email_dialogo_titulo', 'Enviar DeCA por email')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>{t('detalle.email_label_destinatario', 'Destinatario')}</Label>
            <Input
              type="email"
              value={form.destinatario}
              onChange={(e) => setForm((f) => ({ ...f, destinatario: e.target.value }))}
              placeholder="cliente@email.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('detalle.email_label_asunto', 'Asunto (opcional)')}</Label>
            <Input
              value={form.asunto}
              onChange={(e) => setForm((f) => ({ ...f, asunto: e.target.value }))}
              placeholder={t('detalle.email_asunto_placeholder', 'Se genera uno por defecto si lo dejas en blanco')}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('detalle.email_label_cuerpo', 'Mensaje (opcional)')}</Label>
            <Textarea
              rows={6}
              value={form.cuerpo}
              onChange={(e) => setForm((f) => ({ ...f, cuerpo: e.target.value }))}
              placeholder={t('detalle.email_cuerpo_placeholder', 'Se genera un mensaje por defecto si lo dejas en blanco')}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={enviando}>
            {t('expedicion.btn_cancelar')}
          </Button>
          <Button className="gap-2" disabled={enviando} onClick={handleEnviar}>
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {enviando ? t('detalle.email_enviando', 'Enviando...') : t('detalle.email_btn_enviar', 'Enviar')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
