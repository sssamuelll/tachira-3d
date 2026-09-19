/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Raíz de los datos generados por el pipeline cuando no viajan con el
   *  sitio. Sin definir, se sirven desde el propio sitio. La define la Action
   *  de despliegue; en local no se pone. */
  readonly VITE_DATOS?: string
}

/** Sello del build, lo inyecta `define` en vite.config.ts. Nombra la caché
 *  del service worker. */
declare const __BUILD__: string
