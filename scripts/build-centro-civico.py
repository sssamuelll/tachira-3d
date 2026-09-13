# Centro Cívico de San Cristóbal: el conjunto de la Av. 7ma como pieza 3D.
#
# blender --background --python scripts/build-centro-civico.py -- \
#     scripts/centro-civico.json public/data/piezas/centro-civico.glb
#
# QUÉ ES MEDIDO Y QUÉ NO. Medido: la envolvente y su patio, que son el
# multipolígono relation/3499128 de OSM bajado de la API, en metros locales.
# ESTIMADO: todo lo demás —la planta de cada cuerpo, cuántos niveles tiene,
# la altura de nivel y la sección de las arcadas—. Las plantas se digitalizaron
# a ojo sobre la imagen satelital Esri z18, que tiene paralaje sin corregir: el
# techo de una torre alta aparece desplazado respecto a su base. El reparto de
# alturas (sede al sur, rental al norte) es una HIPÓTESIS a confirmar por
# Samuel, que conoce el sitio; la foto aérea de La Prensa del Táchira da las
# proporciones pero no de qué lado cae cada torre.
#
# Blender modela en Z arriba y con Y al norte; el exportador glTF entrega Y
# arriba, que es la convención del visor (X este, Y arriba, Z -norte).
import bpy, bmesh, json, math, sys
from mathutils.geometry import tessellate_polygon

argv = sys.argv[sys.argv.index('--') + 1:]
DATOS, OUT = argv[0], argv[1]

# --- sección de fachada, estimada de la foto --------------------------------
LOSA_CANTO   = 0.30   # la banda blanca de forjado que sobresale en cada nivel
ARCADA_FONDO = 0.35   # cuánto se retranquea el paño entre dos losas
BASE_HONDA   = 8.0    # el arranque baja bajo el apoyo: la manzana está en pendiente
                      # y el visor apoya la pieza por un solo punto

doc = json.load(open(DATOS, encoding='utf-8'))
NIVEL = doc['nivel_m']


def material(nombre, rgb, rough=0.6, metal=0.0):
    m = bpy.data.materials.new(nombre)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m


bpy.ops.wm.read_factory_settings(use_empty=True)

PALETA = {
    'concreto':  material('concreto', (0.70, 0.68, 0.65), rough=0.75),
    'terracota': material('terracota', (0.52, 0.28, 0.20), rough=0.70),
    'teja':      material('teja', (0.55, 0.24, 0.15), rough=0.65),
}
BLANCO = material('losa-blanca', (0.86, 0.85, 0.82), rough=0.55)


def centroide(pts):
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def encoger(pts, metros):
    """Retranquea el anillo `metros` hacia dentro.

    ponytail: escala respecto al centroide en vez de desplazar cada lado por su
    bisectriz. Con 0,35 m sobre plantas de 40 m el error es milimétrico y no se
    ve; si algún día una planta se vuelve muy alargada o cóncava, hay que pasar
    al offset por bisectriz.
    """
    cx, cy = centroide(pts)
    radio = max(math.dist((cx, cy), p) for p in pts)
    k = max(0.0, (radio - metros) / radio)
    return [(cx + (p[0] - cx) * k, cy + (p[1] - cy) * k) for p in pts]


def anillo(bm, pts, z):
    return [bm.verts.new((x, y, z)) for x, y in pts]


def faja(bm, aro0, aro1, indice=0):
    """Une dos anillos con quads, cerrando el ciclo."""
    n = len(aro0)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((aro0[i], aro0[j], aro1[j], aro1[i])).material_index = indice


def tapa(bm, aro, indice=0, invertida=False):
    caras = list(reversed(aro)) if invertida else aro
    bm.faces.new(caras).material_index = indice


def tapa_con_hueco(bm, ext, hueco, z, indice=0):
    """Tapa anular: triangula el contorno exterior descontando el patio."""
    puntos = [(x, y) for x, y in ext] + [(x, y) for x, y in hueco]
    verts = [bm.verts.new((x, y, z)) for x, y in puntos]
    contornos = ([(x, y, 0.0) for x, y in ext], [(x, y, 0.0) for x, y in hueco])
    indices = {c: i for i, c in enumerate(puntos)}
    for tri in tessellate_polygon(contornos):
        cara = [verts[indices[(p[0], p[1])]] for p in
                [contornos[0][i] if i < len(ext) else contornos[1][i - len(ext)]
                 for i in tri]]
        bm.faces.new(cara).material_index = indice
    return verts[:len(ext)], verts[len(ext):]


def objeto(bm, nombre, materiales):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    malla = bpy.data.meshes.new(nombre)
    bm.to_mesh(malla)
    bm.free()
    o = bpy.data.objects.new(nombre, malla)
    for m in materiales:
        o.data.materials.append(m)
    bpy.context.collection.objects.link(o)
    return o


def fachada(bm, planta, z0, niveles, indice_paño, indice_losa):
    """Levanta `niveles` plantas: losa que vuela y paño retranqueado entre ellas.

    Devuelve la cota de coronación.
    """
    fuera = list(planta)
    dentro = encoger(planta, ARCADA_FONDO)
    z = z0
    aro = anillo(bm, fuera, z)
    for _ in range(niveles):
        a_losa_baja = anillo(bm, fuera, z)
        a_losa_alta = anillo(bm, fuera, z + LOSA_CANTO)
        faja(bm, aro, a_losa_baja, indice_losa)
        faja(bm, a_losa_baja, a_losa_alta, indice_losa)
        a_paño_baja = anillo(bm, dentro, z + LOSA_CANTO)
        a_paño_alta = anillo(bm, dentro, z + NIVEL)
        faja(bm, a_losa_alta, a_paño_baja, indice_losa)   # intradós del vuelo
        faja(bm, a_paño_baja, a_paño_alta, indice_paño)
        aro = anillo(bm, fuera, z + NIVEL)
        faja(bm, a_paño_alta, aro, indice_losa)
        z += NIVEL
    return z, aro


# --- el zócalo: la envolvente OSM con su patio -------------------------------
env = doc['envolvente']
zocalo = next(c for c in doc['cuerpos'] if c.get('usa_envolvente'))
alto_zocalo = zocalo['niveles'] * NIVEL

bm = bmesh.new()
ext_bajo = anillo(bm, env['outer'], -BASE_HONDA)
int_bajo = anillo(bm, env['inner'], -BASE_HONDA)
ext_alto, int_alto = tapa_con_hueco(bm, env['outer'], env['inner'], alto_zocalo, 0)
faja(bm, ext_bajo, ext_alto, 0)
faja(bm, int_alto, int_bajo, 0)
objeto(bm, 'zocalo', [PALETA[zocalo['material']]])

# --- los cuerpos altos -------------------------------------------------------
for c in doc['cuerpos']:
    if c.get('usa_envolvente'):
        continue
    planta = [tuple(p) for p in c['planta']]
    bm = bmesh.new()
    base = anillo(bm, planta, -BASE_HONDA)
    arranque = anillo(bm, planta, 0.0)
    faja(bm, base, arranque, 0)
    tapa(bm, base, 0, invertida=True)

    if c.get('arcadas'):
        cima, aro = fachada(bm, planta, 0.0, c['niveles'], 0, 1)
    else:
        cima = c['niveles'] * NIVEL
        aro = anillo(bm, planta, cima)
        faja(bm, arranque, aro, 0)

    if c.get('techo') == 'piramidal':
        cx, cy = centroide(planta)
        cumbre = bm.verts.new((cx, cy, cima + c['techo_alto_m']))
        for i in range(len(aro)):
            bm.faces.new((aro[i], aro[(i + 1) % len(aro)], cumbre)).material_index = 0
    else:
        remate = c.get('remate_m', 0.0)
        if remate:
            chico = encoger(planta, 2.5)
            a0 = anillo(bm, chico, cima)
            a1 = anillo(bm, chico, cima + remate)
            tapa_aro = anillo(bm, planta, cima)
            faja(bm, aro, tapa_aro, 1)
            faja(bm, a0, a1, 0)
            tapa(bm, a1, 0)
            # corona del antepecho alrededor de la casa de máquinas
            faja(bm, tapa_aro, a0, 1)
        else:
            tapa(bm, aro, 0)

    objeto(bm, c['id'], [PALETA[c['material']], BLANCO])

for o in bpy.context.collection.objects:
    o.select_set(True)

bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB',
                          export_yup=True, use_selection=True, export_apply=True)

tri = sum(len(o.data.loop_triangles) for o in bpy.context.collection.objects
          if o.data.calc_loop_triangles() is None or True)
print(f'[centro-civico] exportado {OUT}')
for c in doc['cuerpos']:
    alto = c['niveles'] * NIVEL + c.get('remate_m', 0) + c.get('techo_alto_m', 0)
    print(f"[centro-civico] {c['id']}: {c['niveles']} niveles, {alto:.1f} m")
