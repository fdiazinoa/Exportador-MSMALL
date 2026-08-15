Exportador MSMall Standard

Destino recomendado:
- Windows Server 2016 o superior, x64.
- SQL Server 2008 o superior seleccionando el perfil correcto.

Puede instalar el servicio Windows desde el TAB Servicios del dashboard.
Como alternativa, abra PowerShell como administrador y ejecute:
  .\install-startup-task.ps1

El servicio se registra como ExportadorMSMall, inicia automaticamente con
Windows y continua ejecutando los jobs sin mantener una ventana abierta.

Abra http://127.0.0.1:3000 para configurar el Exportador.

SEGURIDAD WEB:
- En el primer acceso debe crear una clave administrativa de 12 caracteres o mas.
- La clave protege configuracion, consultas, logs, ejecucion manual y servicio.
- Para controlar el servicio se solicita nuevamente la clave.
- El dashboard solo escucha en el servidor local por defecto.
- Si olvida la clave, ejecute reset-web-access.ps1 como Administrador. El script
  conserva un respaldo de security.json y permite crear una clave nueva.
