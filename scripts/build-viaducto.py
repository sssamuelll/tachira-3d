# Viaductos de San Cristóbal: tablero barrido sobre la directriz real de OSM,
# con pilas hasta el terreno y pretiles.
#
# blender --background --python build-viaducto.py -- <viaductos.json> <nombre> <alto_m> <salida.glb>
#
# La directriz NO es inventada: son los ways con bridge=yes de OSM, en metros
# locales respecto al centro del tablero. Lo estimado es la sección (ancho de
# calzada, canto, forma de pila) y la altura, medida contra el DEM del visor.
#
# Blender modela en Z arriba; el exportador glTF entrega Y arriba, que es la
# convención del visor (X este, Y arriba, Z -norte). Blender Y = norte.
import bpy, bmesh, json, math, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
DATOS, NOMBRE, ALTO, OUT = argv[0], argv[1], float(argv[2]), argv[3]

# --- sección, estimada ------------------------------------------------------
ANCHO_CARRIL = 3.5
HOMBRILLO    = 1.0     # sobreancho a cada lado de la calzada
CANTO        = 1.6     # espesor del tablero
PRETIL_ALTO  = 1.05
PRETIL_ANCHO = 0.35
PILA_CADA    = 32.0    # separación entre ejes de pila, metros
PILA_LADO    = 2.2     # sección cuadrada de la pila
PILA_HONDO   = 60.0    # baja lo suficiente para enterrarse donde el terreno sube

datos = json.load(open(DATOS, encoding='utf-8'))[NOMBRE]

bpy.ops.wm.read_factory_settings(use_empty=True)

def material(nombre, rgb, rough):
    m = bpy.data.materials.new(nombre); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    return m

HORMIGON = material('hormigon', (0.62, 0.61, 0.58), 0.80)
ASFALTO  = material('asfalto',  (0.17, 0.17, 0.18), 0.92)

def puntos_blender(pts):
    """[x_este, z_menos_norte] -> (x, y=norte) de Blender, sin repetidos."""
    salida = []
    for x, z in pts:
        p = Vector((x, -z, 0.0))
        if not salida or (p - salida[-1]).length > 0.05:
            salida.append(p)
    return salida

def normal(a, b):
    d = (b - a); d.z = 0
    if d.length < 1e-6: return Vector((0, 0, 0))
    d.normalize()
    return Vector((-d.y, d.x, 0))     # perpendicular en planta

def cinta(bm, eje, semi, z0, z1):
    """Prisma recto de sección rectangular barrido sobre el eje."""
    izq, der = [], []
    for i, p in enumerate(eje):
        a = eje[max(i - 1, 0)]; b = eje[min(i + 1, len(eje) - 1)]
        n = normal(a, b) if (b - a).length > 1e-6 else Vector((0, 1, 0))
        izq.append(p + n * semi); der.append(p - n * semi)
    aros = []
    for z in (z0, z1):
        aros.append(([bm.verts.new((v.x, v.y, z)) for v in izq],
                     [bm.verts.new((v.x, v.y, z)) for v in der]))
    (bi, bd), (ti, td) = aros
    n = len(eje)
    for i in range(n - 1):
        bm.faces.new((bi[i], bi[i+1], ti[i+1], ti[i]))      # costado izquierdo
        bm.faces.new((td[i], td[i+1], bd[i+1], bd[i]))      # costado derecho
        bm.faces.new((ti[i], ti[i+1], td[i+1], td[i]))      # cara superior
        bm.faces.new((bd[i], bd[i+1], bi[i+1], bi[i]))      # cara inferior
    bm.faces.new((bi[0], ti[0], td[0], bd[0]))              # testeros
    bm.faces.new((bd[-1], td[-1], ti[-1], bi[-1]))

def objeto(bm, nombre, mat):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    m = bpy.data.meshes.new(nombre); bm.to_mesh(m); bm.free()
    o = bpy.data.objects.new(nombre, m); o.data.materials.append(mat)
    bpy.context.collection.objects.link(o)

for k, c in enumerate(datos['cintas']):
    eje = puntos_blender(c['pts'])
    if len(eje) < 2: continue
    semi = (c['canales'] * ANCHO_CARRIL) / 2 + HOMBRILLO

    bm = bmesh.new(); cinta(bm, eje, semi, ALTO - CANTO, ALTO)
    objeto(bm, f'tablero-{k}', HORMIGON)

    # capa de rodadura, apenas por encima del tablero
    bm = bmesh.new(); cinta(bm, eje, semi - PRETIL_ANCHO, ALTO, ALTO + 0.06)
    objeto(bm, f'rodadura-{k}', ASFALTO)

    # pretiles a ambos lados
    for signo in (1, -1):
        despl = []
        for i, p in enumerate(eje):
            a = eje[max(i-1, 0)]; b = eje[min(i+1, len(eje)-1)]
            n = normal(a, b) if (b - a).length > 1e-6 else Vector((0, 1, 0))
            despl.append(p + n * signo * (semi - PRETIL_ANCHO / 2))
        bm = bmesh.new(); cinta(bm, despl, PRETIL_ANCHO / 2, ALTO, ALTO + PRETIL_ALTO)
        objeto(bm, f'pretil-{k}-{signo}', HORMIGON)

    # pilas a intervalos, saltando los extremos (ahí van los estribos)
    largo = sum((eje[i+1] - eje[i]).length for i in range(len(eje)-1))
    n_pilas = max(int(largo // PILA_CADA), 1)
    for j in range(1, n_pilas):
        s = largo * j / n_pilas
        rec = 0.0
        for i in range(len(eje)-1):
            paso = (eje[i+1] - eje[i]).length
            if rec + paso >= s:
                t = (s - rec) / paso
                p = eje[i].lerp(eje[i+1], t)
                bpy.ops.mesh.primitive_cube_add(size=1, location=(p.x, p.y, ALTO - CANTO - PILA_HONDO/2))
                pila = bpy.context.object
                pila.scale = (PILA_LADO, PILA_LADO, PILA_HONDO)
                pila.name = f'pila-{k}-{j}'
                pila.data.materials.append(HORMIGON)
                break
            rec += paso

for o in bpy.context.collection.objects:
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True,
                          use_selection=True, export_apply=True)
print(f'[viaducto] {NOMBRE}: {len(datos["cintas"])} cintas, tablero a {ALTO} m -> {OUT}')
