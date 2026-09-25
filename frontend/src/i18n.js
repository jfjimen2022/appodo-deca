import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import deca_es from './locales/es/deca.json'
import deca_en from './locales/en/deca.json'
import common_es from './locales/es/common.json'
import common_en from './locales/en/common.json'

const idiomaGuardado = (() => {
  try { return localStorage.getItem('deca_idioma') } catch { return null }
})()

i18n.use(initReactI18next).init({
  resources: {
    es: { deca: deca_es, common: common_es },
    en: { deca: deca_en, common: common_en },
  },
  lng: idiomaGuardado || 'es',
  fallbackLng: 'es',
  defaultNS: 'common',
  ns: ['common', 'deca'],
  interpolation: { escapeValue: false },
})

export default i18n
