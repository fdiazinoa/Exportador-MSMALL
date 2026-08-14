param(
    [string]$ServiceName = "ExportadorMSMall",
    [int]$HandoffProcessId = 0
)

$ErrorActionPreference = "Stop"

$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($currentIdentity)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "Se requieren permisos de administrador. Solicitando elevacion UAC..."
    $quotedScript = '"' + $PSCommandPath + '"'
    $quotedServiceName = '"' + $ServiceName + '"'
    $arguments = "-NoProfile -ExecutionPolicy Bypass -File $quotedScript -ServiceName $quotedServiceName -HandoffProcessId $HandoffProcessId"
    $process = Start-Process powershell.exe -ArgumentList $arguments -Verb RunAs -Wait -PassThru
    exit $process.ExitCode
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$serviceExe = Join-Path $root "ExportadorMSMallService.exe"
$serviceXml = Join-Path $root "ExportadorMSMallService.xml"
$appExe = Join-Path $root "exportador-msmall-node.exe"
$logsDir = Join-Path $root "logs"

if (-not (Test-Path $serviceExe)) {
    throw "No se encontro el wrapper de servicio: $serviceExe"
}
if (-not (Test-Path $appExe)) {
    throw "No se encontro el ejecutable: $appExe"
}
if (-not (Test-Path $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
}

$escapedRoot = [Security.SecurityElement]::Escape($root)
$escapedAppExe = [Security.SecurityElement]::Escape($appExe)
$escapedLogsDir = [Security.SecurityElement]::Escape($logsDir)

$xml = @"
<service>
  <id>$ServiceName</id>
  <name>Exportador MSMall</name>
  <description>Servicio de exportacion y sincronizacion MsMall.</description>
  <executable>$escapedAppExe</executable>
  <workingdirectory>$escapedRoot</workingdirectory>
  <env name="EXPORTADOR_RUN_MODE" value="service" />
  <logpath>$escapedLogsDir</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10485760</sizeThreshold>
    <keepFiles>5</keepFiles>
  </log>
  <onfailure action="restart" delay="10 sec" />
  <onfailure action="restart" delay="30 sec" />
  <resetfailure>1 hour</resetfailure>
  <startmode>Automatic</startmode>
</service>
"@

Set-Content -Path $serviceXml -Value $xml -Encoding UTF8

$existingService = Get-WmiObject Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
if ($existingService) {
    $registeredPath = [Environment]::ExpandEnvironmentVariables([string]$existingService.PathName).Trim()
    if ($registeredPath.StartsWith('"')) {
        $registeredPath = $registeredPath.Substring(1).Split('"')[0]
    } else {
        $exePosition = $registeredPath.ToLowerInvariant().IndexOf('.exe')
        if ($exePosition -ge 0) {
            $registeredPath = $registeredPath.Substring(0, $exePosition + 4)
        }
    }

    $registeredFullPath = [IO.Path]::GetFullPath($registeredPath)
    $currentFullPath = [IO.Path]::GetFullPath($serviceExe)
    if (-not $registeredFullPath.Equals($currentFullPath, [StringComparison]::OrdinalIgnoreCase)) {
        Write-Host "Migrando servicio desde '$registeredFullPath' hacia '$currentFullPath'..."
        Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
        & sc.exe delete $ServiceName | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "No se pudo eliminar el registro anterior del servicio. Codigo $LASTEXITCODE."
        }

        $deadline = [DateTime]::UtcNow.AddSeconds(20)
        do {
            Start-Sleep -Milliseconds 500
            $existingService = Get-WmiObject Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
            if ([DateTime]::UtcNow -ge $deadline -and $existingService) {
                throw "Windows no libero el registro anterior del servicio dentro de 20 segundos."
            }
        } while ($existingService)
    }
}

$existingService = Get-WmiObject Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
if (-not $existingService) {
    Write-Host "Instalando servicio Windows '$ServiceName'..."
    & $serviceExe install
    if ($LASTEXITCODE -ne 0) {
        throw "La instalacion WinSW fallo con codigo $LASTEXITCODE."
    }
} else {
    Write-Host "El servicio Windows '$ServiceName' ya esta instalado."
}

if ($HandoffProcessId -gt 0) {
    $handoffScript = Join-Path $root "start-service-after-exit.ps1"
    if (-not (Test-Path $handoffScript)) {
        throw "No se encontro el script de traspaso: $handoffScript"
    }

    $handoffArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$handoffScript`" -ParentProcessId $HandoffProcessId -ServiceName `"$ServiceName`""
    Start-Process powershell.exe -ArgumentList $handoffArgs -WindowStyle Hidden | Out-Null
    Write-Host "Servicio instalado. Se iniciara cuando cierre la instancia interactiva."
} else {
    Write-Host "Iniciando servicio Windows '$ServiceName'..."
    & $serviceExe start
    if ($LASTEXITCODE -ne 0) {
        throw "El inicio del servicio fallo con codigo $LASTEXITCODE."
    }

    Start-Sleep -Seconds 2
    Write-Host "Servicio instalado e iniciado. Puede cerrar la ventana del Exportador."
}
