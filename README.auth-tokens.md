# Auth por Tokens (MsMall + MsExportador)

Este módulo agrega autenticación por tokens con `mall_id` (sin `tenant_id`) para uso combinado entre MsMall y MsExportador.

Nota de implementación (inferencia por stack actual): este repo no usa ORM/DB para config, así que el módulo usa un store local en JSON con migraciones de esquema (`data/auth-store.json`) para mantener compatibilidad con el servicio actual.

## Endpoints principales

- `POST /api/auth/token` (app/password o exporter/client_credentials)
- `POST /api/auth/refresh` (refresh token rotation)
- `POST /api/auth/revoke`
- `POST /api/auth/revoke/local`
- `POST /api/auth/revoke/mall`
- `GET /api/tokens`
- `POST /api/tokens`
- `PATCH /api/tokens/:id/status`
- `POST /api/tokens/:id/regenerate`
- `POST /api/ingest/payload` (endpoint de ingestión ejemplo protegido)

## Variables de entorno

Obligatorias/recomendadas:

- `MSMALL_AUTH_JWT_SECRET` (obligatoria en producción)
- `MSMALL_CONFIG_PATH` (opcional, default `config/default.json`)
- `MSMALL_AUTH_STORE_PATH` (opcional, default `data/auth-store.json`)
- `MSMALL_AUTH_APP_USERS_JSON` (JSON array de usuarios app)
- `MSMALL_AUTH_PROTECT_CONFIG_ROUTES=true` (opcional; protege `/api/config`, `/api/test/*`, `/api/schema`)

TTLs (configurables):

- `MSMALL_AUTH_ACCESS_TTL_APP_SECONDS` (default 1800 = 30 min)
- `MSMALL_AUTH_REFRESH_TTL_APP_SECONDS` (default 1209600 = 14 días)
- `MSMALL_AUTH_ACCESS_TTL_EXPORTER_SECONDS` (default 43200 = 12 h)
- `MSMALL_AUTH_REFRESH_TTL_EXPORTER_SECONDS` (default 7776000 = 90 días)

Rate limit auth:

- `MSMALL_AUTH_RATE_LIMIT_WINDOW_MS` (default 60000)
- `MSMALL_AUTH_RATE_LIMIT_MAX` (default 30)

Ejemplo `MSMALL_AUTH_APP_USERS_JSON`:

```json
[
  {
    "username": "admin",
    "password": "cambiar-esto",
    "scopes": ["tokens:manage", "app:read", "app:write", "mapping:read", "export:write"],
    "allowed_malls": ["MALL-1", "MALL-2"]
  }
]
```

## Flujo rápido

1. Emitir token `app` con `POST /api/auth/token` (`grant_type=password`).
2. Crear token `exporter` con `POST /api/tokens` (admin) y `provision_service_account=true`.
3. MsExportador usa `client_id/client_secret` en `POST /api/auth/token` (`grant_type=client_credentials`).
4. Usar access token en endpoints protegidos (`Authorization: Bearer ...`).
5. Renovar con `POST /api/auth/refresh` antes del vencimiento.
6. Revocar por token/local/mall según incidente.

## Integración MsExportador (recomendada)

- Guardar `client_id` y `client_secret` emitidos una sola vez.
- Obtener access+refresh al iniciar el servicio (`client_credentials`).
- Renovar automáticamente cuando falte ~20% de vida del access token.
- Si `refresh` falla con `401`, reautenticar con `client_id/client_secret`.
- En cada envío incluir `mall_id`, `local_id`, `mapping_key`; el backend valida que coincidan con claims + mapping autorizado.
- No loggear access/refresh tokens completos (solo `jti` o ids parciales).

## Mapping autorizado para ingestión

Agregar en `config/default.json` (o config activa):

```json
{
  "ingestion": {
    "authorizedMappings": [
      { "mall_id": "MALL-1", "local_id": "LOCAL-1", "mapping_key": "sales" }
    ]
  }
}
```

## Errores comunes / HTTP

- `400 invalid_scope`: scope solicitado no permitido
- `400 missing_local_id`: token exporter sin `local_id`
- `401 invalid_access_token`: JWT inválido/expirado
- `401 invalid_refresh_token`: refresh inválido o reutilizado
- `401 token_revoked`: token revocado/inactivo
- `403 missing_scope`: falta scope requerido
- `403 local_id_mismatch`: payload.local_id != claim del token exporter
- `403 mapping_not_authorized`: mapping no autorizado para `mall_id/local_id`
- `429 rate_limited`: demasiados intentos en endpoints sensibles de auth

## Migraciones y pruebas

- Migrar/inicializar store auth: `npm run auth:migrate`
- Ejecutar tests de flujo auth: `npm test`

## Seguridad implementada

- JWT firmado `HS256` (no `none`)
- Claims mínimas: `mall_id`, `local_id` (exporter), `token_type`, `scope`, `jti`, `iat`, `exp`
- Refresh token en formato opaco con hash `scrypt` (no plaintext en store)
- Refresh token rotation (reuso de refresh revoca la sesión)
- Revocación individual / por local / por mall
- Auditoría básica (`issued`, `refreshed`, `revoked`, `used`, `failed`)
- Middleware reusable por scope y guard de ingestión `mall/local/mapping`

## Limitaciones / TODO (marcado)

- Este repo no es el backend MsMall final; el endpoint `/api/ingest/payload` es un endpoint ejemplo para validar la política de claims/scopes.
- En MsMall backend real, aplicar el middleware a los endpoints de ingestión productivos y usar una base de datos central si se requiere multi-instancia.
