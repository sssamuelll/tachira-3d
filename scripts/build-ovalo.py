# Isla ovalada de protección del Obelisco de los Italianos, con sus dos fuentes.
# blender --background --python ovalo.py -- <salida.glb>
#
# Geometría paramétrica, no generada por un modelo: las medidas son ESTIMADAS de
# la fotografía de Samuel y están todas aquí arriba para corregirlas de una.
# Se modela en Z arriba (Blender) y el exportador glTF lo entrega en Y arriba,
# que es la convención del visor (X este, Y arriba, Z -norte).
import bpy, bmesh, math, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
OUT = argv[0]

# --- medidas, todas ESTIMADAS de la foto -------------------------------------
OVALO_LARGO   = 30.0   # eje mayor de la isla, metros
OVALO_ANCHO   = 14.0   # eje menor
BROCAL_ALTO   = 0.55   # altura del borde sobre la calzada
BROCAL_ANCHO  = 0.45   # espesor del brocal
FUENTE_DIAM   = 5.0    # diámetro de cada fuente
FUENTE_SEP    = 9.5    # distancia del centro del obelisco al centro de cada fuente
FUENTE_HONDO  = 0.35   # profundidad del vaso bajo el borde
LADOS         = 96     # resolución del óvalo

def material(nombre, rgb, rough=0.6, metal=0.0):
    m = bpy.data.materials.new(nombre)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m

bpy.ops.wm.read_factory_settings(use_empty=True)

CONCRETO = material('concreto', (0.72, 0.70, 0.67), rough=0.75)
AZUL     = material('azulejo-azul', (0.05, 0.22, 0.45), rough=0.25)
AGUA     = material('agua', (0.10, 0.32, 0.48), rough=0.08)

def anillo(bm, a, b, z, n=LADOS):
    """Anillo de vértices de una elipse de semiejes a y b a la cota z."""
    return [bm.verts.new((a * math.cos(2 * math.pi * i / n),
                          b * math.sin(2 * math.pi * i / n), z)) for i in range(n)]

def faja(bm, aro0, aro1):
    """Une dos anillos con quads, cerrando el ciclo."""
    n = len(aro0)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((aro0[i], aro0[j], aro1[j], aro1[i]))

def tapa(bm, aro):
    bm.faces.new(aro)

# --- la isla: losa con brocal perimetral -------------------------------------
bm = bmesh.new()
a_ext, b_ext = OVALO_LARGO / 2, OVALO_ANCHO / 2
a_int, b_int = a_ext - BROCAL_ANCHO, b_ext - BROCAL_ANCHO

base_ext = anillo(bm, a_ext, b_ext, 0.0)
alto_ext = anillo(bm, a_ext, b_ext, BROCAL_ALTO)
alto_int = anillo(bm, a_int, b_int, BROCAL_ALTO)
piso_int = anillo(bm, a_int, b_int, BROCAL_ALTO - 0.12)   # el interior baja un poco

faja(bm, base_ext, alto_ext)     # cara exterior del brocal
faja(bm, alto_ext, alto_int)     # coronación del brocal
faja(bm, alto_int, piso_int)     # cara interior
tapa(bm, list(reversed(piso_int)))
tapa(bm, base_ext)

bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
malla = bpy.data.meshes.new('isla')
bm.to_mesh(malla); bm.free()
isla = bpy.data.objects.new('isla', malla)
isla.data.materials.append(CONCRETO)
bpy.context.collection.objects.link(isla)

# --- las dos fuentes ---------------------------------------------------------
for signo, nombre in ((1, 'fuente-este'), (-1, 'fuente-oeste')):
    cx = signo * FUENTE_SEP
    r = FUENTE_DIAM / 2
    bm = bmesh.new()
    z_borde = BROCAL_ALTO - 0.12 + 0.30      # el vaso sobresale del piso de la isla
    z_fondo = z_borde - FUENTE_HONDO

    ext_b = [bm.verts.new((cx + r * math.cos(t), r * math.sin(t), BROCAL_ALTO - 0.12))
             for t in [2 * math.pi * i / LADOS for i in range(LADOS)]]
    ext_a = [bm.verts.new((cx + r * math.cos(t), r * math.sin(t), z_borde))
             for t in [2 * math.pi * i / LADOS for i in range(LADOS)]]
    int_a = [bm.verts.new((cx + (r - 0.25) * math.cos(t), (r - 0.25) * math.sin(t), z_borde))
             for t in [2 * math.pi * i / LADOS for i in range(LADOS)]]
    int_f = [bm.verts.new((cx + (r - 0.25) * math.cos(t), (r - 0.25) * math.sin(t), z_fondo))
             for t in [2 * math.pi * i / LADOS for i in range(LADOS)]]

    faja(bm, ext_b, ext_a)
    faja(bm, ext_a, int_a)
    faja(bm, int_a, int_f)
    tapa(bm, list(reversed(int_f)))
    tapa(bm, ext_b)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    m = bpy.data.meshes.new(nombre)
    bm.to_mesh(m); bm.free()
    o = bpy.data.objects.new(nombre, m)
    o.data.materials.append(AZUL)
    bpy.context.collection.objects.link(o)

    # lámina de agua, apenas por debajo del borde
    bpy.ops.mesh.primitive_circle_add(vertices=LADOS, radius=r - 0.3,
                                      location=(cx, 0, z_borde - 0.08), fill_type='NGON')
    agua = bpy.context.object
    agua.name = nombre + '-agua'
    agua.data.materials.append(AGUA)

for o in bpy.context.collection.objects:
    o.select_set(True)

bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB',
                          export_yup=True, use_selection=True,
                          export_apply=True)
print(f'[ovalo] exportado {OUT}')
print(f'[ovalo] isla {OVALO_LARGO} x {OVALO_ANCHO} m, brocal {BROCAL_ALTO} m, '
      f'fuentes de {FUENTE_DIAM} m a {FUENTE_SEP} m del centro')
