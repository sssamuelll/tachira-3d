# Sella un GLB con la procedencia que exige el manifiesto de piezas.
# Blender no expone asset.extras, así que se parchea el trozo JSON del contenedor.
# python sellar-glb.py <pieza.glb> <nota>
import json, struct, sys, pathlib


def sellar_glb(ruta, nota=''):
    ruta = pathlib.Path(ruta)
    datos = ruta.read_bytes()

    magic, version, total = struct.unpack('<III', datos[:12])
    assert magic == 0x46546C67, 'no es un GLB'

    trozos, off = [], 12
    while off < total:
        largo, tipo = struct.unpack('<II', datos[off:off + 8])
        trozos.append([tipo, datos[off + 8: off + 8 + largo]])
        off += 8 + largo

    JSON_T, BIN_T = 0x4E4F534A, 0x004E4942
    doc = json.loads(trozos[0][1].decode('utf-8'))
    doc.setdefault('asset', {}).setdefault('extras', {}).update({
        'representación': 'generada',
        'units': 'metres',
        'axes': {'X': 'east', 'Y': 'up', 'Z': '-north'},
        'nota': nota,
    })
    nuevo = json.dumps(doc, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    nuevo += b' ' * ((4 - len(nuevo) % 4) % 4)          # los trozos van alineados a 4
    trozos[0][1] = nuevo

    cuerpo = b''
    for tipo, contenido in trozos:
        relleno = b'\x00' if tipo == BIN_T else b' '
        contenido += relleno * ((4 - len(contenido) % 4) % 4)
        cuerpo += struct.pack('<II', len(contenido), tipo) + contenido

    total_nuevo = 12 + len(cuerpo)
    ruta.write_bytes(struct.pack('<III', magic, version, total_nuevo) + cuerpo)
    print(f'sellado {ruta.name}: {len(datos)} -> {total_nuevo} bytes')


if __name__ == '__main__':
    sellar_glb(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else '')
