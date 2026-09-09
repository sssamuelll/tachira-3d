import { clave, type Nodo } from './quadtree'

/** Solo error medido; la demanda infinita de selección no es profundidad del faldón. */
export function errorMallaEdificios(n:Nodo,errores:Record<string,number>|null):number {
  return n.z<=14 ? errores?.[clave(n)]??0 : 0
}

export function ancestrosEdificios(requested: Set<string>): Set<string> {
  const out=new Set<string>()
  for(const k of requested) {
    const [z,x,y]=k.split('/').map(Number)
    for(let level=8;level<=15;level++) out.add(`${level}/${x >> (z-level)}/${y >> (z-level)}`)
  }
  return out
}

/** Suma áreas de hojas disjuntas, no basta con ver un hijo de una tesela. */
export function coberturaEdificios(nodes:Nodo[]):Set<string> {
  const area=new Map<string,number>()
  for(const n of nodes) {
    if(n.z<15) continue
    const d=n.z-15,k=clave({z:15,x:n.x>>d,y:n.y>>d})
    area.set(k,(area.get(k)??0)+4**-d)
  }
  return new Set([...area].filter(([,a])=>a>=1).map(([k])=>k))
}
