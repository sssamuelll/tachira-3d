# Plaza Bolívar de San Cristóbal: la manzana al norte del Centro Cívico.
#
# blender --background --python scripts/build-plaza-bolivar.py -- \
#     scripts/plaza-bolivar.json public/data/piezas/plaza-bolivar.glb
#
# QUÉ ES MEDIDO Y QUÉ NO. Medido, y aquí es casi todo: el perímetro de la
# plaza, el trazado de los doce setos y muros, y el de las seis hileras de
# árboles, tal como están en OSM. ESTIMADO: las alturas y anchos de sección,
# cada árbol concreto sobre su hilera, y el monumento entero —posición incluida,
# porque no está mapeado y lo único que hay es un objeto con sombra en la
# explanada de la imagen satelital Esri z18—.
#
# LA PLATAFORMA ES HORIZONTAL. El terreno de la manzana cae unos 7 m de este a
# oeste (651,7 m en la Casa Steinvorth contra 659,1 m en el C.C. Mauxil, según
# el baseY que el horneado de edificios ya calculó), y la plaza real salva eso
# con escaleras. Aquí se apoya en un punto y se le da un faldón profundo, que
# es lo que hace una plaza en ladera: queda a ras arriba y con muro de
# contención abajo.
#
# ponytail: por eso NO se modelan las cinco escaleras de OSM, 59 m en total.
# Sobre una plataforma horizontal serían peldaños que no suben a ninguna parte.
# Entran el día que un script muestree el DEM tallado y la plataforma deje de
# ser plana, como ya hace build-viaducto.py con su campo `alturas`.
#
# Blender modela en Z arriba y con Y al norte; el exportador glTF entrega Y
# arriba, que es la convención del visor (X este, Y arriba, Z -norte).
import bpy, bmesh, json, math, sys

argv = sys.argv[sys.argv.index('--') + 1:]
DATOS, OUT = argv[0], argv[1]

# --- secciones, todas ESTIMADAS ---------------------------------------------
BASE_HONDA    = 8.0    # cuánto baja el faldón bajo el punto de apoyo
ALZA          = 0.25   # la losa monta sobre el bordillo. Sin esto quedaría
                       # coplanar con el terreno del visor y parpadearía
BROCAL_ALTO   = 0.45   # borde de obra de la jardinera
BROCAL_ANCHO  = 0.55
SETO_ALTO     = 0.80   # la masa verde que asoma sobre el brocal
SETO_ANCHO    = 0.80
MURO_ALTO     = 1.10   # los `barrier=wall` y `block` van más altos que un seto
ARBOL_CADA    = 6.0    # separación sobre la hilera
TRONCO_ALTO   = 2.4
TRONCO_RADIO  = 0.18
COPA_RADIO    = 2.6
COPA_APLASTE  = 0.72   # la copa es un elipsoide, no una bola

doc = json.load(open(DATOS, encoding='utf-8'))


def material(nombre, rgb, rough=0.6, metal=0.0):
    m = bpy.data.materials.new(nombre)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m


bpy.ops.wm.read_factory_settings(use_empty=True)

LOSA    = material('losa-plaza', (0.74, 0.72, 0.68), rough=0.80)
OBRA    = material('brocal', (0.68, 0.66, 0.62), rough=0.75)
VERDE   = material('seto', (0.16, 0.34, 0.13), rough=0.90)
COPA    = material('copa', (0.13, 0.31, 0.11), rough=0.92)
CORTEZA = material('corteza', (0.24, 0.18, 0.13), rough=0.90)
PIEDRA  = material('pedestal', (0.62, 0.60, 0.56), rough=0.70)
BRONCE  = material('bronce', (0.29, 0.22, 0.11), rough=0.42, metal=0.85)


def cerrada(pts):
    return len(pts) > 2 and math.dist(pts[0], pts[-1]) < 0.05


def normales(pts, anillo):
    """Normal por vértice, promediando los dos segmentos que concurren."""
    n = len(pts)
    salida = []
    for i in range(n):
        antes = pts[i - 1] if (i > 0 or anillo) else pts[i]
        luego = pts[(i + 1) % n] if (i < n - 1 or anillo) else pts[i]
        dx, dy = luego[0] - antes[0], luego[1] - antes[1]
        largo = math.hypot(dx, dy) or 1.0
        salida.append((dy / largo, -dx / largo))
    return salida


def cinta(bm, pts, ancho, z0, z1, indice):
    """Prisma barrido a lo largo de la polilínea, con las esquinas cosidas."""
    anillo = cerrada(pts)
    if anillo:
        pts = pts[:-1]
    if len(pts) < 2:
        return
    n = normales(pts, anillo)
    mitad = ancho / 2
    izq_b, izq_a, der_b, der_a = [], [], [], []
    for (x, y), (nx, ny) in zip(pts, n):
        izq_b.append(bm.verts.new((x + nx * mitad, y + ny * mitad, z0)))
        izq_a.append(bm.verts.new((x + nx * mitad, y + ny * mitad, z1)))
        der_b.append(bm.verts.new((x - nx * mitad, y - ny * mitad, z0)))
        der_a.append(bm.verts.new((x - nx * mitad, y - ny * mitad, z1)))
    tramos = len(pts) if anillo else len(pts) - 1
    for i in range(tramos):
        j = (i + 1) % len(pts)
        bm.faces.new((izq_b[i], izq_b[j], izq_a[j], izq_a[i])).material_index = indice
        bm.faces.new((der_a[i], der_a[j], der_b[j], der_b[i])).material_index = indice
        bm.faces.new((izq_a[i], izq_a[j], der_a[j], der_a[i])).material_index = indice
        bm.faces.new((der_b[i], der_b[j], izq_b[j], izq_b[i])).material_index = indice
    if not anillo:                                                  # tapas de punta
        bm.faces.new((izq_b[0], izq_a[0], der_a[0], der_b[0])).material_index = indice
        bm.faces.new((der_b[-1], der_a[-1], izq_a[-1], izq_b[-1])).material_index = indice


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


# --- la plataforma: el perímetro de OSM con su faldón ------------------------
bm = bmesh.new()
suelo = [bm.verts.new((x, y, -BASE_HONDA)) for x, y in doc['perimetro']]
cara = [bm.verts.new((x, y, ALZA)) for x, y in doc['perimetro']]
n = len(cara)
for i in range(n):
    j = (i + 1) % n
    bm.faces.new((suelo[i], suelo[j], cara[j], cara[i]))
bm.faces.new(cara)
bm.faces.new(list(reversed(suelo)))
objeto(bm, 'plataforma', [LOSA])

def area(pts):
    a = 0.0
    for i in range(len(pts)):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % len(pts)]
        a += x0 * y1 - x1 * y0
    return abs(a) / 2


def dentro(punto, anillo):
    x, y = punto
    hit = False
    for i in range(len(anillo)):
        x0, y0 = anillo[i]
        x1, y1 = anillo[(i + 1) % len(anillo)]
        if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / (y1 - y0) + x0:
            hit = not hit
    return hit


def macizos(setos):
    """Los anillos que hay que rellenar de verde.

    Muchas jardineras vienen en OSM como DOS setos concéntricos, el de fuera y
    el de dentro. Rellenar los dos dejaría dos tapas a la misma cota peleándose
    por el z-buffer, así que se queda el mayor de cada grupo y el pequeño se
    dibuja encima, que es lo que se ve en el sitio: macizo con borde.
    """
    anillos = sorted((seto['linea'][:-1] if cerrada([tuple(p) for p in seto['linea']]) else None
                      for seto in setos if seto['tipo'] == 'hedge'),
                     key=lambda a: -area([tuple(p) for p in a]) if a else 0)
    elegidos = []
    for anillo in anillos:
        if anillo is None:
            continue
        pts = [tuple(p) for p in anillo]
        centro = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
        if any(dentro(centro, ya) for ya in elegidos):
            continue
        elegidos.append(pts)
    return elegidos


# --- jardineras: brocal de obra, relleno y masa verde encima -----------------
bm_obra, bm_verde = bmesh.new(), bmesh.new()
for anillo in macizos(doc['setos']):
    bm_verde.faces.new([bm_verde.verts.new((x, y, ALZA + 0.10)) for x, y in anillo])
for seto in doc['setos']:
    linea = [tuple(p) for p in seto['linea']]
    cinta(bm_obra, linea, BROCAL_ANCHO, ALZA, ALZA + BROCAL_ALTO, 0)
    alto = ALZA + (MURO_ALTO if seto['tipo'] in ('wall', 'block') else BROCAL_ALTO + SETO_ALTO)
    if seto['tipo'] == 'hedge':
        cinta(bm_verde, linea, SETO_ANCHO, ALZA + BROCAL_ALTO, alto, 0)
    else:
        cinta(bm_obra, linea, BROCAL_ANCHO, ALZA + BROCAL_ALTO, alto, 0)
objeto(bm_obra, 'jardineras', [OBRA])
objeto(bm_verde, 'setos', [VERDE])

# --- arbolado: uno cada ARBOL_CADA metros sobre la hilera medida -------------
plantados = 0
bm = bmesh.new()
for hilera in doc['hileras']:
    pts = [tuple(p) for p in hilera['linea']]
    resto = 0.0
    for i in range(len(pts) - 1):
        (x0, y0), (x1, y1) = pts[i], pts[i + 1]
        largo = math.hypot(x1 - x0, y1 - y0)
        s = resto
        while s < largo:
            t = s / largo
            x, y = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
            tronco = bmesh.ops.create_cone(
                bm, cap_ends=True, segments=6, radius1=TRONCO_RADIO, radius2=TRONCO_RADIO * 0.8,
                depth=TRONCO_ALTO)
            for v in tronco['verts']:
                v.co.x += x; v.co.y += y; v.co.z += ALZA + TRONCO_ALTO / 2
            copa = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=COPA_RADIO)
            for v in copa['verts']:
                v.co.z *= COPA_APLASTE
                v.co.x += x; v.co.y += y; v.co.z += ALZA + TRONCO_ALTO + COPA_RADIO * COPA_APLASTE * 0.55
            plantados += 1
            s += ARBOL_CADA
        resto = s - largo
objeto(bm, 'arboles', [CORTEZA])
# Una sola malla con dos materiales sería más barata, pero el tronco y la copa
# salen de dos operadores distintos; se separan por objeto, que es lo legible.
for o in bpy.context.collection.objects:
    if o.name == 'arboles':
        o.data.materials.append(COPA)
        for cara_malla in o.data.polygons:
            cara_malla.material_index = 1 if len(cara_malla.vertices) == 3 else 0

# --- el monumento: lo único sin ningún respaldo de OSM -----------------------
mon = doc['monumento']
cx, cy = mon['centro']
bm = bmesh.new()
lado = mon['pedestal_lado'] / 2
for nivel, (l, z0, z1) in enumerate((
        (lado, ALZA, ALZA + 0.35),                                   # zócalo
        (lado * 0.78, ALZA + 0.35, ALZA + mon['pedestal_alto']),           # dado
        (lado * 0.9, ALZA + mon['pedestal_alto'], ALZA + mon['pedestal_alto'] + 0.3))):  # cornisa
    base = [bm.verts.new((cx + dx * l, cy + dy * l, z0)) for dx, dy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    alto = [bm.verts.new((cx + dx * l, cy + dy * l, z1)) for dx, dy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((base[i], base[j], alto[j], alto[i]))
    bm.faces.new(alto)
    bm.faces.new(list(reversed(base)))
objeto(bm, 'pedestal', [PIEDRA])

# La figura es un volumen sobrio, NO un retrato: de El Libertador no hay aquí
# más dato que su presencia. Modelarle la cara sería inventar con detalle.
bm = bmesh.new()
pie = ALZA + mon['pedestal_alto'] + 0.3
figura = bmesh.ops.create_cone(bm, cap_ends=True, segments=10,
                               radius1=0.78, radius2=0.42, depth=mon['figura_alto'])
for v in figura['verts']:
    v.co.x += cx; v.co.y += cy; v.co.z += pie + mon['figura_alto'] / 2
cabeza = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.40)
for v in cabeza['verts']:
    v.co.x += cx; v.co.y += cy; v.co.z += pie + mon['figura_alto'] + 0.22
objeto(bm, 'figura', [BRONCE])

for o in bpy.context.collection.objects:
    o.select_set(True)

bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB',
                          export_yup=True, use_selection=True, export_apply=True)

print(f'[plaza] exportado {OUT}')
print(f"[plaza] perímetro {len(doc['perimetro'])} vértices, {len(doc['setos'])} setos/muros, "
      f"{len(doc['hileras'])} hileras, {plantados} árboles plantados")
print(f"[plaza] escaleras de OSM NO modeladas ({len(doc['escaleras'])} tramos): plataforma horizontal")
