param([string]$TaskName = "ExportadorMSMall")

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe = Join-Path $root "exportador-msmall-node.exe"

if (-not (Test-Path $exe)) {
    throw "No se encontro el ejecutable: $exe"
}

$command = '"{0}"' -f $exe
& schtasks.exe /Create /TN $TaskName /TR $command /SC ONSTART /RU SYSTEM /RL HIGHEST /F
if ($LASTEXITCODE -ne 0) {
    throw "No se pudo crear la tarea $TaskName. Ejecute PowerShell como administrador."
}

& schtasks.exe /Run /TN $TaskName
Write-Host "Tarea $TaskName instalada e iniciada."
