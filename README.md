# Mis Archivos

PWA para subir y descargar archivos que funciona sin red.

- **Sin red:** los archivos que agregas se guardan en IndexedDB como pendientes.
- **Con red:** se suben los pendientes y se descargan los que haya en el repositorio.
- **Notificaciones:** avisan al terminar cada sincronización.
- **Cache:** *network first*; si no hay red responde el cache. Si falta una imagen se muestra `img/icons/default.png`.

## Dónde se guardan

GitHub Pages solo sirve archivos estáticos, así que el "servidor" es la rama `archivos`
de este mismo repositorio (carpeta `archivos/`), usando la API de GitHub.

- Descargar no requiere nada (el repo es público).
- Subir y borrar requieren un token: en la app abre **Configuración del repositorio** y pega un
  token *fine-grained* limitado a este repo con permiso **Contents: Read and write**
  (GitHub → Settings → Developer settings → Fine-grained tokens).

## Probar en local

```console
npx serve .
```
