# Texturas de asfalto

## Fuente

- **Material:** Asphalt006
- **Sitio:** ambientCG — https://ambientcg.com/view?id=Asphalt006
- **Autor:** Lennart Demes (ambientCG / Struffel Productions)
- **Licencia:** CC0 1.0 Universal (dominio público) — https://creativecommons.org/publicdomain/zero/1.0/
- **Descargado:** 2026-09-07, paquete `Asphalt006_1K-JPG.zip`

CC0 no exige atribución. Este archivo existe igual porque saber de dónde salió
un asset y con qué derechos es parte de poder mantenerlo: sin esto, dentro de
dos años nadie sabe si estas tres imágenes se pueden seguir publicando.

## Qué hay acá y qué se le hizo

| archivo               | del paquete                     | tratamiento                          | tamaño |
|-----------------------|---------------------------------|--------------------------------------|-------:|
| `asfalto-albedo.jpg`  | `Asphalt006_1K-JPG_Color.jpg`   | recomprimido JPEG q≈85 (ffmpeg `-q:v 4`) | 273 KB |
| `asfalto-normal.jpg`  | `Asphalt006_1K-JPG_NormalGL.jpg`| recomprimido JPEG q≈85 (ffmpeg `-q:v 4`) | 1,15 MB |
| `asfalto-rough.jpg`   | `Asphalt006_1K-JPG_Roughness.jpg`| recomprimido a escala de grises (ffmpeg `-q:v 5 -pix_fmt gray`) | 138 KB |

Los tres son 1024×1024 y seamless (el material de ambientCG ya lo es). Del
paquete original quedaron fuera el mapa de oclusión ambiental, el de
desplazamiento y el `NormalDX`: la oclusión de una superficie casi plana no
aporta nada al costo de un sampler más, el desplazamiento lo usará —si lo
usa— el parallax de otra tarea, y la convención DirectX del normal es la que
NO usa este proyecto (three y OpenGL leen el verde hacia arriba).

El originales pesaban 1,5 MB (color) y 2,76 MB (normal): el normal se pasaba
del tope de 2 MB por archivo que se puso esta tarea, y bajar los tres a
calidad 85 no deja artefacto visible a 2 mm por texel, que es la escala a la
que se muestrean (`MICRO_M`, `src/scene/asfalto.ts`).

## Cómo se usan

`src/scene/Roads.tsx` los carga una vez para toda la red y los pasa como
uniforms al fragment shader del pase de relleno (`src/scene/asfalto.ts`).
El albedo va en espacio sRGB; normal y rugosidad, lineales.
