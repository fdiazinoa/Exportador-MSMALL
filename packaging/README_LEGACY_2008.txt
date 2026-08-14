Exportador MSMall V16.0 Legacy-2008

Destino de compatibilidad:
- Windows Server 2008 R2 x64 o superior.
- SQL Server 2008 (TDS 7.3A) o superior.

IMPORTANTE: Windows Server 2008 sin R2 no esta soportado oficialmente por el
runtime Node utilizado. Debe validarse en laboratorio antes de instalarse.

Para instalar al inicio, abra PowerShell como administrador y ejecute:
  .\install-startup-task.ps1

Para SQL Server 2008 seleccione el perfil SQL Server 2008. Use TLS 1.0 heredado
solo si el servidor no tiene las actualizaciones necesarias para TLS 1.2.
