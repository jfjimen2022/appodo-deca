import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import QRCode from 'react-qr-code'
import { Printer, CheckCircle2, ArrowLeft, AlertTriangle } from 'lucide-react'
import { decaService } from '../../services/decaService'

// DeCA hecho SIN COBERTURA (2026-09-30): la hoja que se imprime en la finca
// para que viaje en el camión (Orden FOM/2861/2012 art. 3; art. 5 libre
// edición: el papel vale). Dos ejemplares -- transportista y cargador -- con
// firmas, y la referencia OFF-... que enlaza el papel con el registro que se
// crea solo en Appodo al volver la red.
//
// Se imprime desde el propio móvil (impresora wifi/bluetooth de la caseta o
// "Guardar como PDF" para mandarlo después): nada de esto necesita internet.

function fechaLegible(valor) {
  if (!valor) return ''
  const d = new Date(valor)
  if (Number.isNaN(d.getTime())) return String(valor)
  return d.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function Fila({ etiqueta, valor }) {
  if (valor === null || valor === undefined || valor === '') return null
  return (
    <tr>
      <th scope="row" className="w-[38%] border border-black px-2 py-1 text-left align-top font-semibold">{etiqueta}</th>
      <td className="border border-black px-2 py-1 align-top">{valor}</td>
    </tr>
  )
}

function Ejemplar({ item, empresaNombre, destinatarioCopia, t }) {
  const d = item.datos || {}
  const remolque = d.sin_remolque ? t('offline.imp.sin_remolque') : d.matricula_remolque
  return (
    <section className="deca-ejemplar mx-auto mb-6 max-w-[190mm] bg-white p-4 text-[12px] leading-snug text-black">
      <header className="mb-2 flex items-start justify-between gap-3 border-b-2 border-black pb-2">
        <div>
          <h2 className="text-[16px] font-bold">{t('offline.imp.titulo')}</h2>
          <p>{t('offline.imp.norma')}</p>
        </div>
        <div className="flex items-start gap-3 text-right">
          <div>
            <p className="font-bold">{destinatarioCopia}</p>
            <p className="font-mono">{item.referencia}</p>
          </div>
          {/* QR del DeCA: el código lo generó el móvil y Appodo lo adopta al
              registrarlo, así que lleva al DeCA en cuanto vuelve la red. */}
          {item.token_publico && (
            <QRCode value={decaService.urlDescargaPublica(item.token_publico)} size={96} aria-label={t('offline.imp.qr')} />
          )}
        </div>
      </header>
      <p className="mb-2 border border-black p-1.5 font-semibold">
        {t('offline.imp.emitido_sin_conexion', { fecha: fechaLegible(item.emitido_en), empresa: empresaNombre || '' })}
      </p>
      <table className="w-full border-collapse">
        <tbody>
          <Fila etiqueta={t('offline.imp.cargador')} valor={[d.nombre_cargador, d.nif_cargador].filter(Boolean).join(' · ')} />
          <Fila etiqueta={t('offline.imp.domicilio_cargador')} valor={d.domicilio_cargador} />
          <Fila etiqueta={t('offline.imp.transportista')} valor={[d.nombre_transportista, d.nif_transportista].filter(Boolean).join(' · ')} />
          <Fila etiqueta={t('offline.imp.destinatario')} valor={[d.nombre_destinatario, d.nif_destinatario].filter(Boolean).join(' · ')} />
          <Fila etiqueta={t('offline.imp.origen')} valor={d.origen} />
          <Fila etiqueta={t('offline.imp.destino')} valor={d.destino} />
          <Fila etiqueta={t('offline.imp.fecha')} valor={fechaLegible(d.fecha_hora_transporte)} />
          <Fila etiqueta={t('offline.imp.tractora')} valor={d.matricula_tractor} />
          <Fila etiqueta={t('offline.imp.remolque')} valor={remolque} />
          <Fila etiqueta={t('offline.imp.mercancia')} valor={d.naturaleza_mercancia} />
          <Fila etiqueta={t('offline.imp.peso')} valor={d.peso_kg != null && d.peso_kg !== '' ? `${d.peso_kg} kg` : ''} />
          <Fila etiqueta={t('offline.imp.bultos')} valor={d.bultos} />
          <Fila etiqueta={t('offline.imp.autorizacion')} valor={d.autorizacion_especial} />
          <Fila etiqueta={t('offline.imp.conductor')} valor={[d.nombre_conductor, d.nif_conductor].filter(Boolean).join(' · ')} />
          <Fila etiqueta={t('offline.imp.albaran')} valor={[d.numero_albaran, d.numero_cmr].filter(Boolean).join(' · ')} />
          <Fila etiqueta={t('offline.imp.observaciones')} valor={d.comentarios} />
        </tbody>
      </table>
      <div className="mt-4 grid grid-cols-2 gap-4">
        <div className="h-[28mm] border border-black p-1.5">{t('offline.imp.firma_cargador')}</div>
        <div className="h-[28mm] border border-black p-1.5">{t('offline.imp.firma_transportista')}</div>
      </div>
      {item.token_publico && (
        <p className="mt-2 text-[10px]">
          {t('offline.imp.qr_explicacion')} <span className="break-all font-mono">{decaService.urlDescargaPublica(item.token_publico)}</span>
        </p>
      )}
      <p className="mt-1 text-[10px]">{t('offline.imp.pie')}</p>
    </section>
  )
}

// Ejemplares según Configuración de DeCA (1-3): el del transportista siempre
// (es el que viaja), luego cargador y destinatario.
const COPIAS = ['offline.imp.copia_transportista', 'offline.imp.copia_cargador', 'offline.imp.copia_destinatario']

export default function DecaImprimibleSinConexion({ item, empresaNombre, onCerrar, ejemplares = 2, soloGuardado = false }) {
  const { t } = useTranslation('deca')
  const refTitulo = useRef(null)
  useEffect(() => { refTitulo.current?.focus() }, [])

  return createPortal(
    <div className="deca-imprimible fixed inset-0 z-[60] flex flex-col overflow-y-auto bg-[#F1EEF0] text-[#111]">
      {/* Al imprimir solo sale esta hoja: el resto de la app se oculta, y
          cada ejemplar va en su propia página. */}
      <style>{`
        @media print {
          body > *:not(.deca-imprimible) { display: none !important; }
          html, body { overflow: visible !important; height: auto !important; background: #fff !important; }
          .deca-imprimible { position: static !important; overflow: visible !important; background: #fff !important; }
          .deca-no-imprimir { display: none !important; }
          .deca-ejemplar { break-after: page; page-break-after: always; margin: 0 !important; padding: 0 !important; }
          .deca-ejemplar:last-child { break-after: auto; page-break-after: auto; }
        }
      `}</style>

      <div className="deca-no-imprimir flex flex-col gap-3 px-3.5 pt-[calc(16px+env(safe-area-inset-top,0px))] pb-4">
        <h1 ref={refTitulo} tabIndex={-1} className="flex items-center gap-2 text-[23px] font-bold outline-none">
          <CheckCircle2 className="h-7 w-7 text-[#08622F]" aria-hidden="true" />{soloGuardado ? t('campo.guardado_para_luego_titulo') : t('offline.listo_titulo')}
        </h1>
        {soloGuardado ? (
          <>
            <p className="text-[18px] font-bold">{t('campo.guardado_para_luego_desc', { referencia: item.referencia })}</p>
            <p className="flex items-start gap-2 rounded-xl border-2 border-[#C98A00] bg-[#FFF6D6] p-3 text-[17px] font-bold">
              <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0" aria-hidden="true" />{t('campo.guardado_para_luego_aviso')}
            </p>
          </>
        ) : (
          <p className="text-[18px] font-bold">{t('offline.listo_desc', { referencia: item.referencia })}</p>
        )}
        {!soloGuardado && (<>
        <button
          type="button"
          onClick={() => window.print()}
          className="flex min-h-[72px] items-center justify-center gap-2 rounded-2xl bg-[#08622F] text-[22px] font-bold text-white active:scale-[0.98] motion-reduce:transform-none"
        >
          <Printer className="h-7 w-7" aria-hidden="true" />{t('offline.imprimir')}
        </button>
        <p className="text-[16px] font-bold text-[#3B333A]">{t('offline.imprimir_ayuda')}</p>
        </>)}
        <button
          type="button"
          onClick={onCerrar}
          className="flex min-h-[56px] items-center justify-center gap-2 rounded-2xl border-2 border-[#111] bg-white text-[18px] font-bold"
        >
          <ArrowLeft className="h-6 w-6" aria-hidden="true" />{t('offline.volver_lista')}
        </button>
      </div>

      {!soloGuardado && (
        <div className="px-2 pb-8">
          {COPIAS.slice(0, Math.min(3, Math.max(1, Number(ejemplares) || 2))).map((clave) => (
            <Ejemplar key={clave} item={item} empresaNombre={empresaNombre} destinatarioCopia={t(clave)} t={t} />
          ))}
        </div>
      )}
    </div>,
    document.body,
  )
}
