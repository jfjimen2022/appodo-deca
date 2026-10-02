// Reparto de lo que lee la extracción por patrones (regex) cuando NO sabe de
// quién es cada dato: una lista de NIF y otra de matrículas, sin papel.
//
// Bug real (2026-10-01, probando el manual con un albarán de ejemplo): el
// reparto era por ORDEN DE APARICIÓN (1.er NIF ajeno → destinatario, 2.º →
// transportista) y se aplicaba ANTES que la IA y sin mirar la Agenda. Con un
// albarán de empresa + cliente + transportista, el destinatario se quedaba con
// el NIF de la propia empresa y el transportista con el del cliente, aunque el
// transportista estaba en la Agenda con su NIF. A simple vista parecía bien:
// los NOMBRES sí eran correctos.
//
// Orden (Configuración de DeCA → "La agenda manda"):
//  1. Lo que ya está escrito en el formulario nunca se toca.
//  2. Agenda: un NIF que la Agenda tiene en UN solo papel va a ese papel
//     (`nifsAgenda` = {nif: [roles]}, lo calcula el servidor). Un NIF de la
//     Agenda nunca se pone en el hueco de un papel que no es el suyo.
//  3. IA: si la IA dice de quién es un NIF o una matrícula, el reparto no
//     toca ese campo ni reutiliza ese valor en otro.
//  4. Reparto por orden: último recurso; lo que rellena va en `aRevisar`.
//  El CIF de la propia empresa nunca se reparte a ciegas.

const normalizar = (v) => String(v ?? '').toUpperCase().replace(/[\s.-]/g, '')
const ROL_DE_CAMPO = { nif_cargador: 'cargador', nif_transportista: 'transportista', nif_destinatario: 'destinatario' }

export function repartirPorPosicion({
  form, regex, ia = {}, nifsAgenda = {}, cifPropio = null, rolHabitual = 'cargador',
}) {
  const cambios = {}
  const aRevisar = []
  const propio = cifPropio ? normalizar(cifPropio) : null
  const tieneIA = (campo) => ia && ia[campo] != null && String(ia[campo]).trim() !== ''
  const libre = (campo) => !form[campo] && !tieneIA(campo) && !cambios[campo]
  const agenda = Object.fromEntries(Object.entries(nifsAgenda || {}).map(([n, r]) => [normalizar(n), r]))

  // ── NIF ──
  const nifsIA = ['nif_cargador', 'nif_transportista', 'nif_destinatario', 'nif_conductor']
    .filter(tieneIA).map((c) => normalizar(ia[c]))
  const leidos = (regex?.nifs_encontrados || []).map(normalizar)
    .filter((nif) => nif && !nifsIA.includes(nif))

  // 2. La Agenda dice de quién es (solo si es de un único papel). Nunca el
  // CARGADOR: es quien contrata el transporte, y que su NIF salga en el
  // albarán no lo demuestra (decisión del usuario 2026-09-28: si no está
  // claro, se deja en blanco y se elige con "Nosotros" / "El cliente").
  const usados = new Set()
  for (const nif of leidos) {
    const roles = (agenda[nif] || []).filter((r) => r !== 'cargador')
    if (roles.length !== 1 || (agenda[nif] || []).length !== 1) continue
    const campo = `nif_${roles[0]}`
    if (libre(campo)) { cambios[campo] = nif; usados.add(nif) }
  }

  // 4. Reparto por orden con lo que queda (nunca un NIF de la Agenda en un papel ajeno)
  const restantes = leidos.filter((nif) => nif !== propio && !usados.has(nif))
  const ordenRoles = rolHabitual === 'transportista'
    ? ['nif_cargador', 'nif_destinatario']
    : ['nif_destinatario', 'nif_transportista']
  for (const campo of ordenRoles) {
    if (!libre(campo)) continue
    const nif = restantes.find((n) => !usados.has(n) && (!agenda[n] || agenda[n].includes(ROL_DE_CAMPO[campo])))
    if (nif) {
      cambios[campo] = nif
      usados.add(nif)
      aRevisar.push(campo)
    }
  }
  if (rolHabitual === 'transportista' && libre('nif_transportista') && propio) {
    cambios.nif_transportista = propio
  }

  // ── Matrículas ── (la del remolque lleva la R delante: va al remolque)
  const matriculasIA = ['matricula_tractor', 'matricula_remolque'].filter(tieneIA).map((c) => normalizar(ia[c]))
  const matriculas = (regex?.matriculas_encontradas || []).map(normalizar)
    .filter((m) => m && !matriculasIA.includes(m) && !matriculasIA.includes(m.replace(/^R/, '')))
  const remolque = matriculas.find((m) => /^R\d/.test(m))
  if (remolque && libre('matricula_remolque')) cambios.matricula_remolque = remolque
  const otras = matriculas.filter((m) => m !== remolque)
  for (const campo of ['matricula_tractor', 'matricula_remolque']) {
    if (!libre(campo)) continue
    const m = otras.shift()
    if (m) cambios[campo] = m
  }

  return { cambios, aRevisar }
}
