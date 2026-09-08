import * as THREE from 'three'

export const CONTACTO_PX=1024
const empty=new THREE.DepthTexture(1,1)
empty.compareFunction=THREE.LessEqualCompare
empty.needsUpdate=true
export const uniformesContacto={
  uContactoMapa:{value:empty}, uContactoOn:{value:0},
  uContactoMat:{value:new THREE.Matrix4()},
}
export function liberarContacto() {
  uniformesContacto.uContactoOn.value=0
  uniformesContacto.uContactoMapa.value=empty
}

/** Mapa exclusivo de sólidos: conserva los sesgos montañosos de CSM. El
 * receptor interpola cuatro comparaciones con corrección de plano por texel;
 * evita acné sin separar varios metros el contacto en techos inclinados al sol. */
export const contactoGLSL=/* glsl */`
uniform highp sampler2DShadow uContactoMapa;
uniform mat4 uContactoMat;
uniform float uContactoOn;
float sombraEdificios(vec3 posW) {
  if(uContactoOn<0.5) return 1.0;
  vec3 c=(uContactoMat*vec4(posW,1.0)).xyz;
  vec3 dx=dFdx(c),dy=dFdy(c);
  float det=dx.x*dy.y-dx.y*dy.x;
  vec2 slope=abs(det)>1e-12 ? vec2(dx.z*dy.y-dy.z*dx.y,dy.z*dx.x-dx.z*dy.x)/det : vec2(0.0);
  if(any(lessThan(c,vec3(0.0))) || any(greaterThan(c,vec3(1.0)))) return 1.0;
  vec2 p=c.xy*${CONTACTO_PX.toFixed(1)}-0.5;
  vec2 f=fract(p),uv=(floor(p)+0.5)/${CONTACTO_PX.toFixed(1)};
  float sum=0.0;
  for(int y=0;y<2;y++) for(int x=0;x<2;x++) {
    vec2 offset=vec2(float(x),float(y));
    vec2 tap=uv+offset/${CONTACTO_PX.toFixed(1)};
    float depth=c.z+dot(slope,tap-c.xy)-0.000007;
    vec2 weight=mix(1.0-f,f,offset);
    sum+=texture(uContactoMapa,vec3(tap,depth))*weight.x*weight.y;
  }
  float edge=min(min(c.x,c.y),min(1.0-c.x,1.0-c.y));
  return mix(1.0,sum,smoothstep(0.0,0.04,edge));
}
`

export function parcharContacto(shader:THREE.WebGLProgramParametersWithUniforms) {
  Object.assign(shader.uniforms,uniformesContacto)
  shader.vertexShader=shader.vertexShader
    .replace('#include <common>','#include <common>\nvarying vec3 vContactoW;')
    .replace('#include <project_vertex>','#include <project_vertex>\nvContactoW=(modelMatrix*vec4(transformed,1.0)).xyz;')
  shader.fragmentShader=shader.fragmentShader
    .replace('#include <common>',`#include <common>\nvarying vec3 vContactoW;\n${contactoGLSL}`)
    .replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
      float contacto=sombraEdificios(vContactoW);
      reflectedLight.directDiffuse *= contacto;
      reflectedLight.directSpecular *= contacto;`)
}

const bias=new THREE.Matrix4().set(0.5,0,0,0.5,0,0.5,0,0.5,0,0,0.5,0.5,0,0,0,1)
const center=new THREE.Vector3(),offset=new THREE.Vector3(),right=new THREE.Vector3(),up=new THREE.Vector3()
export function camaraContacto(camera:THREE.OrthographicCamera,target:THREE.Vector3,sun:THREE.Vector3,width:number) {
  camera.left=-width/2;camera.right=width/2;camera.top=width/2;camera.bottom=-width/2
  camera.near=1;camera.far=12000
  camera.position.copy(target).addScaledVector(sun,6000)
  camera.lookAt(target)
  camera.updateMatrixWorld(true)
  right.setFromMatrixColumn(camera.matrixWorld,0);up.setFromMatrixColumn(camera.matrixWorld,1)
  const texel=width/CONTACTO_PX
  center.copy(target)
  offset.copy(right).multiplyScalar(Math.round(center.dot(right)/texel)*texel-center.dot(right))
  offset.addScaledVector(up,Math.round(center.dot(up)/texel)*texel-center.dot(up))
  camera.position.add(offset)
  camera.updateProjectionMatrix();camera.updateMatrixWorld(true)
  uniformesContacto.uContactoMat.value.copy(bias).multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse)
}
