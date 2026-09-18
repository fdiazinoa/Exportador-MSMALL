# Protocolo oficial de generación de Packs

Este documento define el único proceso autorizado para generar Packs del
Exportador MSMall.

## Fuente y ubicación únicas

- Fuente oficial: rama `develop`, sincronizada exactamente con `origin/develop`.
- Comando oficial: `npm run release:pack`, ejecutado desde la raíz del repositorio.
- Salida oficial: `release-packs/vMAJOR.MINOR/`.
- Fuente única de versión: campo `version` de `package.json`.
- Un release siempre genera juntas las ediciones `Standard` y `Legacy-2008`.

No se deben distribuir Packs creados desde ramas `feature`, `fix`, `hotfix`,
worktrees de desarrollo, carpetas antiguas `ServicePack` ni ejecuciones directas
de `scripts/build-edition.js`.

## Preparación obligatoria

1. Fusionar mediante PR todos los cambios aprobados hacia `develop`.
2. Cambiar al checkout oficial del repositorio y ejecutar:

   ```bash
   git switch develop
   git pull --ff-only origin develop
   npm ci
   npm --prefix frontend ci
   ```

3. Confirmar que no existan cambios pendientes con `git status`.
4. Actualizar únicamente `version` en `package.json` mediante un PR previo. El
   empaquetador aplica automáticamente esa versión a las dos ediciones.

## Generación

Ejecutar exclusivamente:

```bash
npm run release:pack
```

El comando se detiene automáticamente cuando:

- la rama no es `develop`;
- `develop` no coincide con `origin/develop`;
- existen cambios locales o archivos sin confirmar;
- la versión de `package.json` no usa el formato `MAJOR.MINOR.PATCH`;
- fallan pruebas, lint o build del frontend;
- falta algún archivo obligatorio del Pack;
- no se generan las dos ediciones.

## Salida y distribución

La carpeta `release-packs/vMAJOR.MINOR/` contiene únicamente:

- `ExportadorMSMall-Vx.y-Standard-win-x64.zip`;
- `ExportadorMSMall-Vx.y-Legacy-2008-win-x64.zip`;
- `release-manifest.json` con commit, tamaños y SHA-256.

Solo se distribuyen los ZIP cuyos hashes coincidan con el manifiesto. No se
copian ejecutables o scripts sueltos desde otras carpetas.

## Verificación en Windows antes de entregar

En una máquina representativa para cada edición:

1. Descomprimir el ZIP en una carpeta nueva.
2. Abrir el dashboard y confirmar la versión mostrada.
3. Validar conexiones y ejecutar un Job de prueba.
4. Instalar `ExportadorMSMall` desde el TAB `Servicios`.
5. Cerrar la ventana y confirmar que el servicio continúa en `services.msc`.
6. Reiniciar Windows y verificar ejecución automática y actualización de logs.
7. Probar detener, iniciar, reiniciar y quitar el servicio.

El responsable del release registra el resultado y los hashes del manifiesto
antes de entregar los Packs al cliente.
