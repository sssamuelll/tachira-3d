import { useCallback, useEffect, useState } from 'react'

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
  useEffect(() => { document.documentElement.dataset.tema = tema }, [tema])

  const alternar = useCallback(() => {
    setTema(t => {
      const nuevo: Tema = t === 'claro' ? 'oscuro' : 'claro'
      guardar(nuevo)
      return nuevo
    })
  }, [])

  return { tema, alternar }
}
