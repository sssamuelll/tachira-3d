# Empalmes de puentes: plan de ejecución

Objetivo: bajar claramente el p99 del quiebre medido en los mismos accesos, conservar la continuidad de cota y no aumentar ninguna penetración.

- [x] Capturar los binarios originales y medir accesos por nodos OSM: 882 extremos, 852 medibles, 30 sin acceso. Medir la peor rama en bifurcaciones.
- [x] Ampliar el perfil del carving con anclas explícitas y detección de imposibilidad, reutilizando sus envolventes sin iteraciones. Compartir el smoothstep y el rasterizador con perfiles suministrados.
- [x] Capturar la topología antes de orientar. Recorrer accesos hasta cruces, conservar cotas compartidas y construir acuerdos locales acotados, sin tocar vías remotas.
- [x] Corregir tableros demasiado inclinados solo levantando el extremo bajo y hasta donde permiten las longitudes de acceso. Documentar límites y exclusiones.
- [x] Tallar los corredores de acceso con banda lateral existente y proteger el terreno bajo puentes contra aumentos. No cambiar vectorizer ni GLB.
- [x] Sustituir el horneado por una auditoría dispersa exacta, certificada contra las cotas y holguras de la referencia. Medir geometría Float32 y terreno solo alrededor de los puentes.
- [x] Ejecutar vitest, TypeScript, build y verify. Escribir resultados y encuadres de perfil en Chrome con coordenadas y hora, sin abrir navegador.
- [ ] Horneado manual del dueño: datos + imagen + verify. **Autorización de ejecución por el agente revocada: no ejecutar data ni img.**

Resultado y comandos: [informe de empalmes](../../empalmes-puentes.md). La simulación baja el p99 34,1 % y conserva los 450 mínimos de holgura o los mejora. Persisten 16 cadenas fuera de límite y asperezas declaradas; no se afirma continuidad universal.

Implementación: `scripts/lib/bridge-approaches.mjs`, `scripts/build-data.mjs`, extensiones de `scripts/lib/carving.mjs` y `scripts/lib/structures.mjs`; regresiones sintéticas en `scripts/test`. Auditor independiente en `scripts/audit-bridge-joins.mjs`.

Límite descubierto: los máximos de clase del perfil no son garantías del DEM rasterizado. Las rampas nuevas se comprueban sobre alturas propias; los casos sin longitud suficiente deben quedar declarados, nunca forzarse para aprobar el percentil.
