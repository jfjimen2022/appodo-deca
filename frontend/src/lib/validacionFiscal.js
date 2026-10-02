/**
 * Validación del dígito de control de identificadores fiscales españoles
 * (DNI/NIF, NIE y CIF).
 *
 * Espejo de `saas_erp/core/validadores_fiscales.py` — mantener en paralelo.
 *
 * Solo se usa para AVISAR bajo el campo del formulario de alta; nunca para
 * bloquear el envío (decisión del usuario 2026-08-27: "si es de otro país se
 * valida igual, no perdemos ningún cliente").
 */

const LETRAS_DNI = 'TRWAGMYFPDXBNJZSQVHLCKE'
const LETRAS_CIF_CONTROL = 'JABCDEFGHI'
const CIF_ORG_SOLO_LETRA = new Set(['K', 'P', 'Q', 'S'])
const CIF_ORG_SOLO_NUMERO = new Set(['A', 'B', 'E', 'H'])

const RE_DNI = /^\d{8}[A-Z]$/
const RE_NIE = /^[XYZ]\d{7}[A-Z]$/
const RE_CIF = /^[ABCDEFGHJKLMNPQRSUVW]\d{7}[0-9A-J]$/

export function normalizarFiscal(valor) {
  return (valor || '').toUpperCase().replace(/[\s\-.]/g, '')
}

function letraDniCorrecta(numero8) {
  return LETRAS_DNI[parseInt(numero8, 10) % 23]
}

export function validarDNI(valor) {
  const v = normalizarFiscal(valor)
  if (!RE_DNI.test(v)) return false
  return v[8] === letraDniCorrecta(v.slice(0, 8))
}

export function validarNIE(valor) {
  const v = normalizarFiscal(valor)
  if (!RE_NIE.test(v)) return false
  const numero = { X: '0', Y: '1', Z: '2' }[v[0]] + v.slice(1, 8)
  return v[8] === letraDniCorrecta(numero)
}

export function validarCIF(valor) {
  const v = normalizarFiscal(valor)
  if (!RE_CIF.test(v)) return false
  const org = v[0]
  const digitos = v.slice(1, 8)
  const control = v[8]

  let sumaPar = 0
  let sumaImpar = 0
  for (let i = 0; i < digitos.length; i++) {
    const n = parseInt(digitos[i], 10)
    if (i % 2 === 0) {
      const doble = n * 2
      sumaImpar += Math.floor(doble / 10) + (doble % 10)
    } else {
      sumaPar += n
    }
  }
  const digitoControl = (10 - ((sumaPar + sumaImpar) % 10)) % 10
  const letraControl = LETRAS_CIF_CONTROL[digitoControl]

  if (CIF_ORG_SOLO_LETRA.has(org)) return control === letraControl
  if (CIF_ORG_SOLO_NUMERO.has(org)) return control === String(digitoControl)
  return control === String(digitoControl) || control === letraControl
}

export function validarNIFPersona(valor) {
  return validarDNI(valor) || validarNIE(valor)
}

/**
 * @param {string} valor
 * @param {'empresa'|'autonomo'|'particular'} tipoTitular
 * @returns {boolean}
 */
export function validarIdentificadorFiscal(valor, tipoTitular) {
  const v = normalizarFiscal(valor)
  if (!v) return false
  if (tipoTitular === 'empresa') return validarCIF(v) || validarNIFPersona(v)
  if (tipoTitular === 'autonomo' || tipoTitular === 'particular') return validarNIFPersona(v)
  return validarCIF(v) || validarNIFPersona(v)
}
