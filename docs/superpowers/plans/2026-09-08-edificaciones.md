# Capa de edificaciones: ejecución

**Objetivo:** masa urbana determinista, identificable y apoyada al DEM tallado, con sombra, AO y coste acotado. Implementa la especificación entregada por Samuel el 8 de septiembre de 2026.

**Arquitectura:** horneado independiente de OSM, huellas y geometría ENU por tesela z15. Manifest pequeño; binarios fusionados por bloque y metadatos por edificio separados. Carga espacial con histéresis por metros/píxel; terreno refinado antes de mostrar edificios. Se conserva el CSM actual y se añade sombra de contacto exclusiva de edificios porque sus sesgos montañosos eliminan sombras de pocos metros.

**Restricciones:** no navegador; no edición ni persistencia; no regenerar assets existentes de public/data; OSM original solo lectura. Imagen local z12 no permite medir techos: medir únicamente en cobertura z18 disponible, con fuente explícita para el respaldo.

- [x] Morfología y pruebas: área/forma, densidad vecinal, influencia vial, campo espacial continuo y variación pequeña por id. Datos válidos height > levels > estimación.
- [x] Ingestión y horneado: copia crudos, deduplica por tipo/id, conserva patios y tags, registra descartes; DEM final PNG Terrarium z12, misma diagonal que las vías; techos con mediana satelital interior.
- [x] Geometría: separar perímetros en cruces de triángulos del DEM, cubierta plana por encima del terreno, muros y patios con normales correctas; binario indexado con color lineal.
- [x] Render: un mesh opaco por bloque; carga limitada, LRU, castShadow/receiveShadow, CSM compartido y AO existente. Exactitud del terreno requerida por z15 antes de mostrar.
- [x] Contacto: mapa adicional solo de edificios, sin volver a dibujar relieve/vías; aplica a luz directa del relieve, edificios y asfalto. Sesgos de montaña conservados.
- [x] Verificación: 505 pruebas, tsc y build completos; assets, triángulos, bloques y apoyo medidos; horneados deterministas; comprobación Chrome con hora fija documentada. Coste GPU/FPS pendiente de revisión visual del dueño.

Informe final: [edificaciones-tachira.md](../../edificaciones-tachira.md).
