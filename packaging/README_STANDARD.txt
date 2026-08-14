Exportador MSMall V16.3 Standard

Destino recomendado:
- Windows Server 2016 o superior, x64.
- SQL Server 2008 o superior seleccionando el perfil correcto.

Puede instalar el servicio Windows desde el TAB Servicios del dashboard.
Como alternativa, abra PowerShell como administrador y ejecute:
  .\install-startup-task.ps1

El servicio se registra como ExportadorMSMall, inicia automaticamente con
Windows y continua ejecutando los jobs sin mantener una ventana abierta.

Abra http://localhost:3000 para configurar el Exportador.
