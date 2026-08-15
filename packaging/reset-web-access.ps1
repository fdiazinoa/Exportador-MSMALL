#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'

$packPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$securityFile = Join-Path $packPath 'config\security.json'
$sessionsPath = Join-Path $packPath 'config\sessions'
$serviceName = 'ExportadorMSMall'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'

$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
$wasRunning = $service -and $service.Status -ne 'Stopped'
if ($wasRunning) {
    Stop-Service -Name $serviceName -Force
    (Get-Service -Name $serviceName).WaitForStatus('Stopped', (New-TimeSpan -Seconds 30))
}

if (Test-Path $securityFile) {
    $backupFile = "$securityFile.$timestamp.bak"
    Move-Item -LiteralPath $securityFile -Destination $backupFile
    Write-Host "Respaldo creado: $backupFile"
} else {
    Write-Host 'No existe una clave configurada en este Pack.'
}

if (Test-Path $sessionsPath) {
    Get-ChildItem -LiteralPath $sessionsPath -File | Remove-Item -Force
}

if ($wasRunning) {
    Start-Service -Name $serviceName
}

Write-Host 'Acceso restablecido. Abra http://127.0.0.1:3000 y cree una clave nueva.'
Read-Host 'Presione Enter para cerrar'
