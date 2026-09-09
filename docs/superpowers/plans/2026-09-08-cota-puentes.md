# Cota propia de puentes

**Objetivo:** resolver en el horneado la rasante de los puentes OSM completos y retirar la calzada superficial de los túneles.

**Alcance autorizado:** solicitud del usuario del 2026-09-08. Regenerar `public/data`, conservar piezas y vectorizer, no ejecutar `npm run img` ni abrir navegador. Mantener IDs de vías y verificar tests, TypeScript, build y datos.

**Método:** grafo de nodos OSM sobre geometría original, con componentes separadas por `layer`. Recorrer cadenas abiertas no ramificadas; interpolar por distancia acumulada entre las cotas de sus dos extremos sobre el DEM tallado. Conservar el sentido de cada way, incluidas inversiones `oneway=-1`. Las paralelas tienen nodos propios y perfiles independientes. No convertir `layer` en metros ni elevar para coincidir con las piezas. Registrar componentes ambiguas y penetración del terreno. El vado `low_water_crossing` conserva el drapeado.

- [x] `scripts/lib/structures.mjs` y `scripts/test/structures.test.mjs`: encadenado antes de subdividir, rasante después del tallado, normales de tablero sin inclinación transversal del valle; regresiones de fragmentación, orientación, paralelas, capas, ramas, anillos y rasante contra DEM.
- [x] `scripts/build-data.mjs`, `scripts/lib/overpass.mjs`, `scripts/lib/pack.mjs` y pruebas: conservar nodos; integrar la rasante sin `apoyar` en puentes resueltos; túneles sin segmentos visibles, conservando metadata e índices CSR. Guardar auditoría reproducible del horneado.
- [x] `scripts/verify-data.mjs`: validar binarios, estructuras y ausencia de segmentos de túnel, además de los controles actuales.
- [x] Regenerar con `npm run data` cronometrado; ejecutar `npx vitest run`, `npx tsc --noEmit`, `npm run build`, `npm run verify`.
- [x] `docs/cota-puentes.md`: números de los 451 ways, cotas de ambos viaductos frente a piezas, límites del DEM, coste y pasos exactos para Chrome con coordenadas y `?hora=`.

**Criterio de evidencia:** una interpolación calculable no demuestra por sí sola una cota física correcta. Separar éxito topológico de penetración del DEM y de comparación contra las piezas; publicar discrepancias sin ajustar los extremos para esconderlas. Medir holgura del eje a pasos de hasta 5 m; la comprobación visual de bordes y piezas corresponde al usuario.
