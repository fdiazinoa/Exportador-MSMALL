param([string]$TaskName = "ExportadorMSMall")

$ErrorActionPreference = "Stop"
& schtasks.exe /Delete /TN $TaskName /F
if ($LASTEXITCODE -ne 0) {
    throw "No se pudo eliminar la tarea $TaskName."
}
Write-Host "Tarea $TaskName eliminada."
