import { useCallback, useLayoutEffect, useState } from 'react'

export type Tema = 'claro' | 'oscuro'

const CLAVE = 'tachira3d.tema'

/** Qué tema toca: lo que el usuario eligió si eligió algo reconocible, y si no
 *  lo que dice el sistema. Puro, para poder probarlo sin navegador. */
export function temaDe (guardado: string | null, prefiereOscuro: boolean): Tema {
  if (guardado === 'claro' || guardado === 'oscuro') return guardado
  return prefiereOscuro ? 'oscuro' : 'claro'
}

/** localStorage lanza en una ventana privada y con las cookies bloqueadas. El
 *  mapa tiene que abrir igual, así que todo acceso va envuelto. */
const leer = (): string | null => {
  try { return localStorage.getItem(CLAVE) } catch { return null }
}
const guardar = (t: Tema) => {
  try { localStorage.setItem(CLAVE, t) } catch { /* sin memoria, pero funciona */ }
}

export function usarTema () {
  const [tema, setTema] = useState<Tema>(() =>
    temaDe(leer(), typeof matchMedia === 'function' &&
      matchMedia('(prefers-color-scheme: dark)').matches))

  // El atributo en la raíz es lo que activa la paleta oscura del CSS (tema.ts).
  // useLayoutEffect y no useEffect: React corre los efectos de los HIJOS
  // antes que los del padre, y MiniMapa usa un useEffect corriente para
  // repintar su disco cuando cambia el tema (Step 6b) -- con un useEffect
  // acá, ese repintado se disparaba antes de que este efecto llegara a poner
  // `data-tema`, así que leía todavía la paleta vieja vía getComputedStyle.
  // Los efectos de capa (useLayoutEffect) de TODO el árbol corren antes que
  // los pasivos de TODO el árbol, así que esto sí le gana la carrera.
  useLayoutEffect(() => { document.documentElement.dataset.tema = tema }, [tema])

  const alternar = useCallback(() => {
    setTema(t => {
      const nuevo: Tema = t === 'claro' ? 'oscuro' : 'claro'
      guardar(nuevo)
      return nuevo
    })
  }, [])

  return { tema, alternar }
}
