import { ShapeUtils, Vector2 } from 'three'
import { geodeticToEnu } from './enu.mjs'
import { tileXf, tileYf, tileXToLon, tileYToLat } from './terrarium.mjs'

const world = (frame, [lon, lat], h = 0) => {
  const [e,n,u] = geodeticToEnu(frame,lat,lon,h)
  return [e,u,-n]
}
const signedArea = r => r.reduce((s,p,i) => {
  const q=r[(i+1)%r.length]; return s+p[0]*q[2]-q[0]*p[2]
},0)/2
const inside = (p,r) => {
  let yes=false
  for(let i=0,j=r.length-1;i<r.length;j=i++) {
    const a=r[i],b=r[j]
    if((a[1]>p[1])!==(b[1]>p[1]) && p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]) yes=!yes
  }
  return yes
}

/** Métricas independientes de la orientación: caja de menor área sobre las
 * direcciones de las aristas, en vez de bbox norte-sur que confunde galpones rotados. */
export function analizarHuella(building,frame) {
  let area=0,perimeter=0
  const points=[]
  for(const p of building.polygons) {
    for(const [j,ring] of [p.outer,...p.holes].entries()) {
      const r=ring.map(c=>world(frame,c))
      area+=(j===0?1:-1)*Math.abs(signedArea(r))
      for(let i=0;i<r.length;i++) perimeter+=Math.hypot(r[i][0]-r[(i+1)%r.length][0],r[i][2]-r[(i+1)%r.length][2])
      if(j===0) points.push(...r)
    }
  }
  const x=points.reduce((s,p)=>s+p[0],0)/points.length
  const z=points.reduce((s,p)=>s+p[2],0)/points.length
  let best=Infinity,elongacion=1
  for(let i=0;i<points.length;i++) {
    const a=points[i],b=points[(i+1)%points.length]
    const l=Math.hypot(b[0]-a[0],b[2]-a[2]); if(l<1e-6) continue
    const cx=(b[0]-a[0])/l,sz=(b[2]-a[2])/l
    let loX=Infinity,hiX=-Infinity,loZ=Infinity,hiZ=-Infinity
    for(const p of points) {
      const u=(p[0]-x)*cx+(p[2]-z)*sz,v=-(p[0]-x)*sz+(p[2]-z)*cx
      loX=Math.min(loX,u);hiX=Math.max(hiX,u);loZ=Math.min(loZ,v);hiZ=Math.max(hiZ,v)
    }
    const w=hiX-loX,h=hiZ-loZ
    if(w*h<best){best=w*h;elongacion=Math.max(w,h)/Math.max(0.01,Math.min(w,h))}
  }
  return {x,z,area,elongacion,compacidad:Math.min(1,4*Math.PI*area/Math.max(1,perimeter**2))}
}

/** El DEM tiene diagonales NE–SW: en posts globales sus aristas son u entero,
 * v entero y u+v entero. Partir allí evita que una pared puentee una cresta.
 * Se conserva el polígono original en metadatos; esta subdivisión solo es apoyo. */
export function apoyarAnillo(ring) {
  const out=[]
  for(let i=0;i<ring.length;i++) {
    const a=ring[i],b=ring[(i+1)%ring.length]
    const u=tileXf(a[0],12)*256,v=tileYf(a[1],12)*256
    const du=tileXf(b[0],12)*256-u,dv=tileYf(b[1],12)*256-v
    const ts=[0]
    for(const [start,delta] of [[u,du],[v,dv],[u+v,du+dv]]) {
      if(Math.abs(delta)<1e-10) continue
      const low=Math.min(start,start+delta),high=Math.max(start,start+delta)
      for(let k=Math.floor(low)+1;k<high;k++) {
        const t=(k-start)/delta
        if(t>1e-8&&t<1-1e-8) ts.push(t)
      }
    }
    ts.sort((a,b)=>a-b)
    for(let j=0;j<ts.length;j++) {
      if(j&&ts[j]-ts[j-1]<1e-8) continue
      const t=ts[j]
      out.push(t===0?a:[tileXToLon((u+du*t)/256,12),tileYToLat((v+dv*t)/256,12)])
    }
  }
  return out
}

const linear = n => {const c=n/255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4}
const byteColor = rgb => rgb.map(c=>Math.round(linear(c)*255))

export function hornearEdificio(building,altura,roof,sample,frame) {
  const positions=[],normals=[],colors=[],indices=[]
  const at=p=>{
    const h=sample(p[1],p[0])
    if(h==null||!Number.isFinite(h)) throw new Error(`DEM sin cobertura: ${building.id}`)
    return world(frame,p,h)
  }
  const polygons=building.polygons.map(p=>({
    outer:p.outer.map(at),holes:p.holes.map(r=>r.map(at)),
  }))
  const support=building.polygons.map(p=>[p.outer,...p.holes].map(r=>apoyarAnillo(r).map(at)))
  // Plano de planta por encima del punto más alto, con cimentación que baja
  // hasta el terreno por arista. Incluye posts interiores: una huella grande
  // puede encerrar una cima aunque todo el borde esté más abajo.
  let baseY=-Infinity
  for(const rings of support) for(const r of rings) for(const p of r) baseY=Math.max(baseY,p[1])
  for(const p of building.polygons) {
    const us=p.outer.map(c=>tileXf(c[0],12)*256),vs=p.outer.map(c=>tileYf(c[1],12)*256)
    for(let u=Math.ceil(Math.min(...us));u<Math.max(...us);u++) {
      for(let v=Math.ceil(Math.min(...vs));v<Math.max(...vs);v++) {
        const c=[tileXToLon(u/256,12),tileYToLat(v/256,12)]
        if(inside(c,p.outer)&&!p.holes.some(r=>inside(c,r))) baseY=Math.max(baseY,at(c)[1])
      }
    }
  }
  baseY+=0.03
  const roofY=baseY+altura.metros
  const roofColor=byteColor(roof.rgb)
  // Revoque claro, mineral y mate; variación cromática del techo con amplitud
  // pequeña, sin inventar pinturas saturadas ni luz en los vertex colors.
  const wallColor=byteColor(roof.rgb.map(c=>Math.round(184*0.82+c*0.18)))
  const vertex=(p,n,c)=>{
    const i=positions.length/3;positions.push(...p);normals.push(...n);colors.push(...c);return i
  }
  for(let pi=0;pi<polygons.length;pi++) {
    const p=polygons[pi]
    const rings=[p.outer,...p.holes]
    const points=rings.flat()
    const first=positions.length/3
    for(const q of points) vertex([q[0],roofY,q[2]],[0,127,0],roofColor)
    const triangles=ShapeUtils.triangulateShape(p.outer.map(q=>new Vector2(q[0],q[2])),p.holes.map(r=>r.map(q=>new Vector2(q[0],q[2]))))
    if(!triangles.length) throw new Error(`Techo no triangulable: ${building.id}`)
    for(const t of triangles) {
      const [a,b,c]=t.map(i=>points[i])
      const up=(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2])
      indices.push(...(up>0?t:[t[0],t[2],t[1]]).map(i=>first+i))
    }
    for(const [ri,r0] of support[pi].entries()) {
      const r=((signedArea(r0)>0)===(ri===0))?r0:[...r0].reverse()
      for(let i=0;i<r.length;i++) {
        const a=r[i],b=r[(i+1)%r.length]
        const dx=b[0]-a[0],dz=b[2]-a[2],l=Math.hypot(dx,dz)
        if(l<1e-6) continue
        const n=[Math.round(127*dz/l),0,Math.round(-127*dx/l)]
        const k=vertex([a[0],a[1]-0.03,a[2]],n,wallColor)
        vertex([b[0],b[1]-0.03,b[2]],n,wallColor)
        vertex([b[0],roofY,b[2]],n,wallColor)
        vertex([a[0],roofY,a[2]],n,wallColor)
        indices.push(k,k+2,k+1,k,k+3,k+2)
      }
    }
  }
  let low=Infinity
  for(const rings of support) for(const r of rings) for(const p of r) low=Math.min(low,p[1])
  const record={id:building.id,osmId:building.osmId,osmType:building.osmType,tags:building.tags,polygons,altura,techo:roof,baseY,roofY,
    apoyo:{fuente:'dem-tallado-z12',desnivel:baseY-0.03-low,cimientoMax:baseY-low,revisar:baseY-low>5}}
  return {record,positions,normals,colors,indices}
}

/** Una sola geometría indexada por bloque. Las normales y colores son bytes
 * normalizados; posiciones ENU Float32 conservan precisión centimétrica. */
export function empaquetarGeometrias(geoms) {
  const vertices=geoms.reduce((s,g)=>s+g.positions.length/3,0)
  const count=geoms.reduce((s,g)=>s+g.indices.length,0)
  const off=Math.ceil((16+vertices*18)/4)*4
  const out=Buffer.alloc(off+count*4)
  out.writeUInt32LE(0x45444946,0);out.writeUInt32LE(1,4);out.writeUInt32LE(vertices,8);out.writeUInt32LE(count,12)
  const pos=new Float32Array(out.buffer,out.byteOffset+16,vertices*3)
  const nrm=new Int8Array(out.buffer,out.byteOffset+16+vertices*12,vertices*3)
  const col=new Uint8Array(out.buffer,out.byteOffset+16+vertices*15,vertices*3)
  const ids=new Uint32Array(out.buffer,out.byteOffset+off,count)
  let v=0,i=0
  for(const g of geoms){
    pos.set(g.positions,v*3);nrm.set(g.normals,v*3);col.set(g.colors,v*3)
    for(const index of g.indices) ids[i++]=v+index
    v+=g.positions.length/3
  }
  return out
}
