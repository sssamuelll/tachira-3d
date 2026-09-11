# Táchira 3D

Un mapa 3D del estado Táchira sobre el terreno real: la vialidad, las
edificaciones y algunas piezas modeladas una a una.

No es un mapa terminado. Es un mapa que la comunidad va llenando, capa a capa,
porque de Venezuela hay poco levantado y lo que hay está repartido.

**Mapa:** https://sssamuelll.github.io/tachira-3d/

## Correrlo

```bash
git clone https://github.com/sssamuelll/tachira-3d
cd tachira-3d
npm ci
npm run datos:bajar     # ~59 MB de datos base, del último Release
npm run dev
```

`npm run datos:bajar` hace falta porque los datos que hornea el pipeline no
caben en git. Van como asset de un Release y el script trae el más reciente.

## Qué hay dentro

El terreno se dibuja con un quadtree sobre teselas de elevación, con nivel de
detalle por distancia, y encima va la imagen satelital, que se pide en vivo y
nunca se guarda. Las vías son geometría fusionada con su calzada extruida en
metros reales, con los puentes a su cota y sus empalmes tallados en el
terreno. Las edificaciones se hornean en teselas y se cargan según la cámara.
Las piezas son modelos generados en Blender que se apoyan solos sobre el
relieve.

Todo dato del mapa separa **lo medido de lo estimado**, y lo dice. La altura
de un edificio sin `building:levels` en OpenStreetMap es una estimación a
partir de su huella y su entorno, y el repo lo declara en vez de disimularlo.

- [Piezas 3D](docs/piezas-3d.md) · [Centro Cívico](docs/centro-civico.md) · [Plaza Bolívar](docs/plaza-bolivar.md)
- [Edificaciones](docs/edificaciones-tachira.md) · [Cota de los puentes](docs/cota-puentes.md) · [Empalmes](docs/empalmes-puentes.md)
- [Especificaciones y planes](docs/superpowers/)

## Hecho con

React 19, three.js y React Three Fiber sobre Vite 8; TypeScript; Vitest.
Los datos salen de OpenStreetMap por Overpass, el relieve de las teselas
Terrarium de AWS Open Data, y las piezas de scripts de Blender.

## Contribuir

Hace falta. Lee [CONTRIBUTING.md](CONTRIBUTING.md).

## Licencias

El código va [MIT](LICENSE). Los datos, no: casi todos derivan de
OpenStreetMap y heredan ODbL. Está todo en [LICENSE-DATOS.md](LICENSE-DATOS.md).

© colaboradores de OpenStreetMap
