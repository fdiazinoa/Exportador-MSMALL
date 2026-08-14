Exportador MSMall V16.3 Legacy-2008

Destino de compatibilidad:
- Windows Server 2008 R2 x64 o superior.
- SQL Server 2008 (TDS 7.3A) o superior.

IMPORTANTE: Windows Server 2008 sin R2 no esta soportado oficialmente por el
runtime Node utilizado. Debe validarse en laboratorio antes de instalarse.

Puede instalar el servicio Windows desde el TAB Servicios del dashboard.
Como alternativa, abra PowerShell como administrador y ejecute:
  .\install-startup-task.ps1

El servicio se registra como ExportadorMSMall, inicia automaticamente con
Windows y continua ejecutando los jobs sin mantener una ventana abierta.

Para SQL Server 2008 seleccione el perfil SQL Server 2008. Use TLS 1.0 heredado
solo si el servidor no tiene las actualizaciones necesarias para TLS 1.2.
