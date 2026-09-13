import { defineConfig } from '@playwright/test'

// El relieve solo se puede juzgar sobre la escena dibujada de verdad, así que
// esto levanta el servidor de desarrollo y abre la app en Chromium con WebGL
// por software (SwiftShader): no hay GPU garantizada donde esto corra.
export default defineConfig({
  testDir: './e2e',
  // Una sola pestaña: cada una arma la pirámide del DEM entera en memoria.
  workers: 1,
  // Armar el quadtree y bajar las teselas por software no es rápido.
  timeout: 2_400_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: 'http://localhost:5173',
    launchOptions: {
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--disable-lcd-text',
      ],
    },
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
