# ─────────────────────────────────────────────────────────────────────────
# PostgreSQL backup script (Windows PowerShell) for video platform.
#
# Usage:
#   .\scripts\backup-db.ps1                     # defaults
#   $env:BACKUP_DIR = "D:\backups"; .\scripts\backup-db.ps1
#
# Schedule via Windows Task Scheduler:
#   Program: powershell.exe
#   Args:    -NoProfile -ExecutionPolicy Bypass -File D:\Videoplayer\scripts\backup-db.ps1
#   Trigger: Daily at 2:00 AM
#
# Uses the running Docker container's pg_dump if available, otherwise
# falls back to local pg_dump.
# ─────────────────────────────────────────────────────────────────────────

$ErrorActionPreference = "Stop"

# ── Config ──────────────────────────────────────────────────────────────
$BackupDir      = if ($env:BACKUP_DIR) { $env:BACKUP_DIR } else { "D:\Videoplayer\backups" }
$RetentionDays  = if ($env:BACKUP_RETENTION_DAYS) { [int]$env:BACKUP_RETENTION_DAYS } else { 30 }
$ContainerName  = if ($env:POSTGRES_CONTAINER) { $env:POSTGRES_CONTAINER } else { "videoplayer-postgres" }
$DbName         = if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { "videoplayer" }
$DbUser         = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { "videoplayer" }
$Timestamp      = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$BackupFile     = Join-Path $BackupDir "videoplayer-$Timestamp.sql.gz"

# ── Pre-flight ──────────────────────────────────────────────────────────
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

$dockerAvailable = $null -ne (Get-Command docker -ErrorAction SilentlyContinue)
if (-not $dockerAvailable) {
    Write-Error "docker CLI not found. This script assumes PostgreSQL runs in Docker."
    exit 1
}

# Verify container is running
$containerRunning = docker ps --format "{{.Names}}" | Select-String -Pattern "^$ContainerName$" -Quiet
if (-not $containerRunning) {
    Write-Error "Container '$ContainerName' is not running. Start it with: docker start $ContainerName"
    exit 1
}

# ── Run backup inside the container, stream out via stdout, gzip locally ─
Write-Host "[$(Get-Date -Format o)] Starting backup to $BackupFile"

$tmpFile = "$BackupFile.tmp"
try {
    # pg_dump inside container → stdout → gzip on host
    docker exec $ContainerName pg_dump -U $DbUser --no-owner --no-acl -d $DbName `
      | & "$env:SystemRoot\System32\cmd.exe" /c "more > $tmpFile"

    # Compress with PowerShell (no gzip on vanilla Windows — use tar)
    if (Get-Command tar -ErrorAction SilentlyContinue) {
        tar -czf $BackupFile -C (Split-Path $tmpFile) (Split-Path $tmpFile -Leaf)
        Remove-Item $tmpFile
    } else {
        # Fallback: keep uncompressed .sql
        Move-Item $tmpFile ($BackupFile -replace '\.gz$', '')
        $BackupFile = $BackupFile -replace '\.gz$', ''
    }

    $size = (Get-Item $BackupFile).Length / 1MB
    Write-Host "[$(Get-Date -Format o)] Backup complete: $BackupFile ($([math]::Round($size, 2)) MB)"
} catch {
    if (Test-Path $tmpFile) { Remove-Item $tmpFile }
    Write-Error "Backup failed: $_"
    exit 1
}

# ── Rotate old backups ─────────────────────────────────────────────────
Write-Host "[$(Get-Date -Format o)] Rotating backups older than $RetentionDays days"
Get-ChildItem -Path $BackupDir -Filter "videoplayer-*" `
  | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$RetentionDays) } `
  | Remove-Item -Force

# ── Summary ─────────────────────────────────────────────────────────────
$count = (Get-ChildItem -Path $BackupDir -Filter "videoplayer-*").Count
$totalSize = [math]::Round(((Get-ChildItem -Path $BackupDir -Filter "videoplayer-*" | Measure-Object -Property Length -Sum).Sum / 1MB), 2)
Write-Host "[$(Get-Date -Format o)] Done. $count backups retained ($totalSize MB total)"
