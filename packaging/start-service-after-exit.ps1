param(
    [Parameter(Mandatory = $true)]
    [int]$ParentProcessId,
    [string]$ServiceName = "ExportadorMSMall"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$serviceExe = Join-Path $root "ExportadorMSMallService.exe"
$logFile = Join-Path $root "logs\service-handoff.log"

try {
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    while (Get-Process -Id $ParentProcessId -ErrorAction SilentlyContinue) {
        if ([DateTime]::UtcNow -ge $deadline) {
            throw "La instancia interactiva no libero el puerto dentro de 30 segundos."
        }
        Start-Sleep -Milliseconds 250
    }
    Start-Sleep -Milliseconds 750
    & $serviceExe stop 2>&1 | Out-File -FilePath $logFile -Append -Encoding UTF8
    Start-Sleep -Milliseconds 500
    & $serviceExe start 2>&1 | Out-File -FilePath $logFile -Append -Encoding UTF8
    if ($LASTEXITCODE -ne 0) {
        throw "El inicio de '$ServiceName' fallo con codigo $LASTEXITCODE."
    }
    "$(Get-Date -Format o) Traspaso completado; servicio '$ServiceName' iniciado." | Out-File -FilePath $logFile -Append -Encoding UTF8
} catch {
    "$(Get-Date -Format o) ERROR: $($_.Exception.Message)" | Out-File -FilePath $logFile -Append -Encoding UTF8
    exit 1
}
