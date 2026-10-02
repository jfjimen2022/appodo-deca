import { useTranslation } from 'react-i18next'
import { CheckCircle2, XCircle } from 'lucide-react'

// "¿Hace falta DeCA para este transporte?" -- el mismo contenido en escritorio
// (diálogo) y en el alta móvil (hoja inferior). Basado en la Orden
// FOM/2861/2012 arts. 1 y 2 y en el art. 33.2.d del ROTT (RD 70/2019),
// revisados contra el BOE el 2026-09-30. Pedido del usuario: que quien da de
// alta sepa si su transporte lo necesita (una furgoneta pequeña, por ejemplo,
// no).
export default function AyudaCuandoDeca({ grande = false }) {
  const { t } = useTranslation('deca')
  const lista = (clave) => {
    const valor = t(clave, { returnObjects: true })
    return Array.isArray(valor) ? valor : []
  }
  const texto = grande ? 'text-[17px] font-bold text-[#111]' : 'text-sm text-gray-800'
  const titulo = grande ? 'text-[19px] font-bold text-[#111]' : 'text-sm font-semibold text-gray-900'

  return (
    <div className="flex flex-col gap-4">
      <p className={texto}>{t('ayuda_deca.intro')}</p>

      <section className="flex flex-col gap-2">
        <h3 className={`${titulo} flex items-center gap-2`}>
          <CheckCircle2 className={grande ? 'h-6 w-6 text-[#08622F]' : 'h-4 w-4 text-emerald-700'} aria-hidden="true" />
          {t('ayuda_deca.si_titulo')}
        </h3>
        <ul className={`list-disc pl-6 flex flex-col gap-1 ${texto}`}>
          {lista('ayuda_deca.si').map((linea) => <li key={linea}>{linea}</li>)}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className={`${titulo} flex items-center gap-2`}>
          <XCircle className={grande ? 'h-6 w-6 text-[#B3121B]' : 'h-4 w-4 text-red-700'} aria-hidden="true" />
          {t('ayuda_deca.no_titulo')}
        </h3>
        <ul className={`list-disc pl-6 flex flex-col gap-1 ${texto}`}>
          {lista('ayuda_deca.no').map((linea) => <li key={linea}>{linea}</li>)}
        </ul>
      </section>

      <p className={texto}>{t('ayuda_deca.cmr')}</p>
      <p className={texto}>{t('ayuda_deca.vehiculo_unico')}</p>
      <p className={grande ? 'text-[15px] text-[#3B333A]' : 'text-xs text-gray-600'}>{t('ayuda_deca.fuente')}</p>
    </div>
  )
}
