# Exportador MSMall V16

V16 mantiene una sola base de codigo y genera dos ediciones compatibles entre
si. El formato de `config/default.json` es compartido.

## Ediciones

| Edicion | Runtime | Sistema operativo objetivo | SQL Server |
| --- | --- | --- | --- |
| Standard | Node 18 empaquetado | Windows Server 2016+ x64 | 2008+ |
| Legacy-2008 | Node 10 empaquetado | Windows Server 2008 R2+ x64 | 2008+ |

Windows Server 2008 sin R2 no fue una plataforma soportada por los runtimes de
Node disponibles para este proyecto. El artefacto Legacy debe probarse en una
maquina representativa antes de autorizar su instalacion en Server 2008.

## Perfiles SQL Server

- `sqlserver2008`: TDS 7.3A.
- `sqlserver2008r2`: TDS 7.3B.
- `modern`: TDS 7.4 para SQL Server 2012 o superior.

Los modos de seguridad son `modern`, `legacy_tls1` y `unencrypted`. TLS 1.0 y
la conexion sin cifrado deben limitarse a redes controladas donde no sea viable
actualizar SQL Server.

## Compilacion

```bash
npm ci
npm --prefix frontend ci
npm test
npm run build:standard
npm run build:legacy-2008
```

Los ZIP se generan en `dist/v16.0/`.
