# Monthly Payroll Deduction Report trigger.
# Run by Windows Task Scheduler on the 1st of each month at 08:00.
# Calls the app's secure cron endpoint, which emails the PREVIOUS month's report to Directors.
#
# Requires the app to be running (npm run dev / production server) at trigger time.

param(
  [string]$BaseUrl = "http://localhost:3000",
  # Never hardcode the secret. Defaults to the CRON_SECRET environment variable;
  # pass -Secret explicitly only if you can't set the env var on the scheduled task.
  [string]$Secret  = $env:CRON_SECRET
)

$ErrorActionPreference = "Stop"
$logDir  = Join-Path $PSScriptRoot "..\logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$logFile = Join-Path $logDir "monthly-payroll.log"
$stamp   = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

if ([string]::IsNullOrWhiteSpace($Secret)) {
  $line = "$stamp  ERROR  CRON_SECRET not set — set the env var or pass -Secret"
  Add-Content -Path $logFile -Value $line -Encoding utf8
  Write-Output $line
  exit 1
}

try {
  # Pass the secret in a header, not the URL (query strings leak into logs).
  $url = "$BaseUrl/api/cron/monthly-payroll"
  $res = Invoke-WebRequest -Uri $url -Method GET -Headers @{ "x-cron-secret" = $Secret } -UseBasicParsing -TimeoutSec 180
  $json = $res.Content | ConvertFrom-Json
  $line = "$stamp  OK  month=$($json.month) mode=$($json.mode) total=$($json.total) recipients=$($json.recipients -join ';')"
  Add-Content -Path $logFile -Value $line -Encoding utf8
  Write-Output $line
} catch {
  $line = "$stamp  ERROR  $($_.Exception.Message)"
  Add-Content -Path $logFile -Value $line -Encoding utf8
  Write-Output $line
  exit 1
}
