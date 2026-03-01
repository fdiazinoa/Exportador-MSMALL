# MsExportador -> MsMall Webservice (Token Auth)

## Objetivo
Agregar una conexion secundaria `webservice` para empujar datos a MsMall usando token `exporter` (MsMall emite/valida tokens por `mall_id + local_id`).

## Flujo (resumen)
1. `MsExportador` usa `clientId/clientSecret` de `webServices.<name>`.
2. Pide token a `POST /auth/token` (`token_type=exporter`).
3. Guarda `accessToken/refreshToken` en `authState` local (runtime) y rota refresh automáticamente.
4. Empuja filas a `POST /api/v1/exporter/sync/ingest` (modo `sync_rows`, recomendado).
5. Si recibe `401`, intenta refresh y reintenta una vez.

## Configuracion (`config/default.json`)
Agregar una entrada en `webServices`:

```json
{
  "webServices": {
    "msmall_local": {
      "baseUrl": "http://127.0.0.1:8000",
      "clientId": "msa_xxx",
      "clientSecret": "...",
      "mallId": "UUID_MALL",
      "localId": "UUID_LOCAL",
      "configId": "UUID_LOCAL_CONFIG",
      "syncPath": "/api/v1/exporter/sync/ingest",
      "manualExecutePath": "/api/v1/remote/execute-manual/exporter",
      "auth": {
        "tokenPath": "/auth/token",
        "refreshPath": "/auth/refresh"
      },
      "mode": "sync_rows",
      "chunkSize": 500,
      "timeoutMs": 30000,
      "retry": {
        "maxAttempts": 3,
        "baseDelayMs": 1000,
        "maxDelayMs": 30000
      }
    }
  }
}
```

## Job config
Usar `destinationType = webservice` y `destination = <clave de webServices>`.

```json
{
  "name": "DailySalesToMsMall",
  "sourceConnection": "sqlserver_prod",
  "query": "SELECT ...",
  "format": "json",
  "destinationType": "webservice",
  "destination": "msmall_local",
  "mapping": {
    "StoreId": "local_codigo",
    "InvoiceNo": "factura_numero"
  }
}
```

## Modo de entrega
- `sync_rows` (recomendado): exporta archivo local y empuja `rows` al endpoint de sync de MsMall.
- `manual_execute`: dispara `POST /api/v1/remote/execute-manual/exporter` usando `configId` (para escenarios donde MsMall debe ejecutar importacion remota por su lado).

## Prueba de conexion desde el panel
- Boton `Test Connection` en la seccion `Web Services (MsMall)`
- Endpoint local: `POST /api/test/webservice`
- Prueba: obtiene token exporter (y opcionalmente sync probe si `testSyncOnConnect=true`)

## Seguridad
- No se loguean tokens completos.
- `/api/config` redacted `authState.accessToken/refreshToken`.
- `POST /api/config` preserva `authState` existente para no perder el refresh token al guardar desde UI.

## Compatibilidad
- No rompe destinos existentes `ftp`/`sftp`.
- Jobs legacy sin `destinationType` siguen funcionando por inferencia (`ftp`, `webservice` o ruta local).
