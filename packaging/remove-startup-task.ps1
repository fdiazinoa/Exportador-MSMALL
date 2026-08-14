param(
    [string]$ServiceName = "ExportadorMSMall"
)

$ErrorActionPreference = "Stop"

$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($currentIdentity)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "Se requieren permisos de administrador. Solicitando elevacion UAC..."
    $quotedScript = '"' + $PSCommandPath + '"'
    $quotedServiceName = '"' + $ServiceName + '"'
    $arguments = "-NoProfile -ExecutionPolicy Bypass -File $quotedScript -ServiceName $quotedServiceName"
    $process = Start-Process powershell.exe -ArgumentList $arguments -Verb RunAs -Wait -PassThru
    exit $process.ExitCode
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$serviceExe = Join-Path $root "ExportadorMSMallService.exe"
$serviceXml = Join-Path $root "ExportadorMSMallService.xml"

if (-not (Test-Path $serviceExe)) {
    throw "No se encontro el wrapper de servicio: $serviceExe"
}

& sc.exe query $ServiceName 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "El servicio Windows '$ServiceName' no esta instalado."
    exit 0
}

Write-Host "Deteniendo servicio Windows '$ServiceName'..."
& $serviceExe stop

Write-Host "Eliminando servicio Windows '$ServiceName'..."
& $serviceExe uninstall
if ($LASTEXITCODE -ne 0) {
    throw "La eliminacion del servicio fallo con codigo $LASTEXITCODE."
}

if (Test-Path $serviceXml) {
    Remove-Item $serviceXml -Force
}

Write-Host "Servicio eliminado."
