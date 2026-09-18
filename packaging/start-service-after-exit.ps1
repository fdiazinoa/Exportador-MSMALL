param(
    [Parameter(Mandatory = $true)]
    [int]$ParentProcessId,
    [string]$ServiceName = "ExportadorMSMall"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$appExe = Join-Path $root "exportador-msmall-node.exe"
$logFile = Join-Path $root "logs\service-handoff.log"

function Write-HandoffLog {
    param([string]$Message)
    "$(Get-Date -Format o) $Message" | Out-File -FilePath $logFile -Append -Encoding UTF8
}

try {
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    while (Get-Process -Id $ParentProcessId -ErrorAction SilentlyContinue) {
        if ([DateTime]::UtcNow -ge $deadline) {
            throw "La instancia interactiva no libero el puerto dentro de 30 segundos."
        }
        Start-Sleep -Milliseconds 250
    }

    Start-Sleep -Milliseconds 750
    $service = Get-Service -Name $ServiceName -ErrorAction Stop
    if ($service.Status -eq 'Running') {
        Write-HandoffLog "Reiniciando servicio '$ServiceName'."
        Restart-Service -Name $ServiceName -Force -ErrorAction Stop
    } else {
        Write-HandoffLog "Iniciando servicio '$ServiceName' desde estado '$($service.Status)'."
        Start-Service -Name $ServiceName -ErrorAction Stop
    }

    $serviceDeadline = [DateTime]::UtcNow.AddSeconds(30)
    do {
        Start-Sleep -Milliseconds 500
        $service = Get-Service -Name $ServiceName -ErrorAction Stop
        if ([DateTime]::UtcNow -ge $serviceDeadline -and $service.Status -ne 'Running') {
            throw "El servicio no alcanzo el estado Running dentro de 30 segundos. Estado: $($service.Status)."
        }
    } while ($service.Status -ne 'Running')

    $healthDeadline = [DateTime]::UtcNow.AddSeconds(30)
    $healthConfirmed = $false
    do {
        try {
            $client = New-Object System.Net.WebClient
            $response = $client.DownloadString('http://127.0.0.1:3000/api/health')
            $client.Dispose()
            $healthConfirmed = $response -match '"ok"\s*:\s*true' -and $response -match '"runtimeMode"\s*:\s*"service"'
        } catch {
            $healthConfirmed = $false
        }
        if (-not $healthConfirmed) {
            Start-Sleep -Milliseconds 500
        }
    } while (-not $healthConfirmed -and [DateTime]::UtcNow -lt $healthDeadline)

    if (-not $healthConfirmed) {
        throw "El servicio esta Running, pero /api/health no confirmo runtimeMode=service dentro de 30 segundos."
    }

    Write-HandoffLog "Traspaso completado; servicio '$ServiceName' y API local operativos."
} catch {
    Write-HandoffLog "ERROR: $($_.Exception.Message)"
    $parentStillRunning = Get-Process -Id $ParentProcessId -ErrorAction SilentlyContinue
    if (-not $parentStillRunning -and (Test-Path $appExe)) {
        try {
            Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
            Start-Process -FilePath $appExe -WorkingDirectory $root | Out-Null
            Write-HandoffLog "Se reabrio la instancia interactiva como recuperacion."
        } catch {
            Write-HandoffLog "ERROR DE RECUPERACION: $($_.Exception.Message)"
        }
    }
    exit 1
}
