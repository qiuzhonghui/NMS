<#
.SYNOPSIS
    NMS - Network Management System
    All-in-One Management Script (Install / Uninstall / Upgrade / Status)

.DESCRIPTION
    Complete management script for NMS on Windows.

.PARAMETER Action
    install | uninstall | upgrade | status (omit for interactive menu)

.EXAMPLE
    .\nms.ps1                  # Interactive menu
    .\nms.ps1 install          # Direct install
    .\nms.ps1 uninstall        # Direct uninstall
    .\nms.ps1 upgrade          # Direct upgrade
    .\nms.ps1 status           # Show status
#>
#Requires -Version 5.1
#Requires -RunAsAdministrator

param(
    [ValidateSet("install", "uninstall", "upgrade", "status", "menu")]
    [string]$Action = "menu"
)

$ErrorActionPreference = "Stop"

# ── Config ──────────────────────────────────────────────────────────────────
$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir
$InstallDir = "C:\NMS"
$Port       = 8000
$DbHost     = "127.0.0.1"
$DbPort     = 3306
$DbName     = "nms"
$DbUser     = "nms"
$DbPassword = ""
$CurrentVersion = "1.0.0"
$VersionFile = Join-Path $InstallDir ".version"

# ── Helpers ─────────────────────────────────────────────────────────────────
function Write-Info  { Write-Host "  [OK]  $args" -ForegroundColor Green }
function Write-Warn  { Write-Host "  [!!]  $args" -ForegroundColor Yellow }
function Write-ErrorMsg { Write-Host "  [XX]  $args" -ForegroundColor Red }
function Write-Step  {
    Write-Host ""
    Write-Host "==> $args" -ForegroundColor Cyan
    Write-Host ""
}
function Write-Banner {
    Write-Host ""
    Write-Host "╔══════════════════════════════════════════════════════╗" -ForegroundColor Blue
    Write-Host "║     NMS - Network Management System                  ║" -ForegroundColor Blue
    Write-Host "║     Management Script v$CurrentVersion                            ║" -ForegroundColor Blue
    Write-Host "╚══════════════════════════════════════════════════════╝" -ForegroundColor Blue
    Write-Host ""
}

function Test-MySqlConnection {
    param([string]$User, [string]$Pass, [string]$HostName = "127.0.0.1", [string]$Database = "")
    $env:MYSQL_PWD = $Pass
    try {
        $args = @("-u", $User, "-h", $HostName, "-e", "SELECT 1")
        if ($Database) { $args += $Database }
        $result = & mysql @args 2>&1
        $env:MYSQL_PWD = ""
        return $LASTEXITCODE -eq 0
    } catch {
        $env:MYSQL_PWD = ""
        return $false
    }
}

function Invoke-MySql {
    param([string]$Sql)
    $env:MYSQL_PWD = $DbPassword
    try {
        $result = & mysql -u $DbUser -h $DbHost $DbName -e $Sql 2>&1
        return $result
    } finally {
        $env:MYSQL_PWD = ""
    }
}

function Write-Fail {
    param([string]$Message)
    Write-Host ""
    Write-Host "FATAL: $Message" -ForegroundColor Red
    Write-Host ""
    exit 1
}

function Check-Step {
    param([string]$Description, [ScriptBlock]$Condition)
    try {
        if (& $Condition) {
            Write-Info $Description
            return $true
        } else {
            Write-ErrorMsg $Description
            return $false
        }
    } catch {
        Write-ErrorMsg "$Description — $_"
        return $false
    }
}

# ═════════════════════════════════════════════════════════════════════════════
# STATUS
# ═════════════════════════════════════════════════════════════════════════════

function Show-Status {
    Write-Banner
    Write-Host "── NMS System Status ──" -ForegroundColor White
    Write-Host ""

    # Installation
    if (Test-Path (Join-Path $InstallDir ".env")) {
        Write-Host "  Install directory: $InstallDir" -ForegroundColor Green
        if (Test-Path $VersionFile) {
            $ver = Get-Content $VersionFile
            Write-Host "  Installed version:  $ver" -ForegroundColor Green
        }
    } else {
        Write-Host "  Install directory: NOT INSTALLED" -ForegroundColor Red
    }

    # Service
    $svc = Get-Service -Name "NMS" -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -eq "Running") {
        Write-Host "  NMS service:        RUNNING" -ForegroundColor Green
    } elseif ($svc) {
        Write-Host "  NMS service:        STOPPED" -ForegroundColor Yellow
    } else {
        Write-Host "  NMS service:        NOT CONFIGURED" -ForegroundColor Red
    }

    # Port
    $portInUse = netstat -ano 2>$null | Select-String ":$Port " | Select-String "LISTENING"
    if ($portInUse) {
        Write-Host "  Port $Port`:          LISTENING" -ForegroundColor Green
    } else {
        Write-Host "  Port $Port`:          NOT LISTENING" -ForegroundColor Yellow
    }

    # MySQL
    $mysqlSvc = Get-Service -Name "MySQL*" -ErrorAction SilentlyContinue
    if ($mysqlSvc -and $mysqlSvc.Status -eq "Running") {
        Write-Host "  MySQL service:      RUNNING" -ForegroundColor Green
    } else {
        Write-Host "  MySQL service:      NOT RUNNING" -ForegroundColor Red
    }

    # Python
    if (Test-Path (Join-Path $InstallDir "venv\Scripts\python.exe")) {
        $pyVer = & (Join-Path $InstallDir "venv\Scripts\python.exe") --version 2>&1
        Write-Host "  Python venv:        $pyVer" -ForegroundColor Green
    } else {
        Write-Host "  Python venv:        NOT FOUND" -ForegroundColor Yellow
    }

    # Health
    try {
        $response = Invoke-RestMethod -Uri "http://localhost:$Port/api/health" -TimeoutSec 5 -ErrorAction Stop
        Write-Host "  Health check:       HTTP 200 OK" -ForegroundColor Green
    } catch {
        Write-Host "  Health check:       NOT RESPONDING" -ForegroundColor Yellow
    }

    Write-Host ""
}

# ═════════════════════════════════════════════════════════════════════════════
# INSTALL
# ═════════════════════════════════════════════════════════════════════════════

function Start-Install {
    Write-Banner

    Write-Host "Starting NMS Installation..." -ForegroundColor Yellow
    Write-Host "  Install dir: $InstallDir"
    Write-Host "  Port:        $Port"
    Write-Host "  Database:    $DbHost`:$DbPort/$DbName"
    Write-Host ""
    $confirm = Read-Host "  Continue? [Y/n]"
    if ($confirm -eq "n") { Write-Host "Aborted."; exit 0 }

    # ── Step 1: Check Python ────────────────────────────────────────────
    Write-Step "Step 1/7  Checking Python..."
    $pythonCmd = $null
    foreach ($cmd in @("python3", "python")) {
        try {
            $ver = & $cmd --version 2>&1
            if ($ver -match "Python (\d+)\.(\d+)" -and [int]$Matches[1] -ge 3 -and [int]$Matches[2] -ge 9) {
                $pythonCmd = $cmd
                break
            }
        } catch {}
    }
    if (-not $pythonCmd) { Write-Fail "Python 3.9+ required. Install from https://www.python.org/downloads/" }
    Check-Step "Python: $(& $pythonCmd --version 2>&1)" { $true }

    # ── Step 2: MySQL ───────────────────────────────────────────────────
    Write-Step "Step 2/7  Setting up MySQL..."
    $mysqlSvc = Get-Service -Name "MySQL*" -ErrorAction SilentlyContinue
    if (-not $mysqlSvc) {
        Write-Warn "MySQL service not found."
        Write-Warn "Please install MySQL 8.0 from: https://dev.mysql.com/downloads/installer/"
        Write-Warn "Or run: winget install Oracle.MySQL"
        Write-Warn ""
        $skip = Read-Host "  MySQL not found. Continue anyway? (y/n)"
        if ($skip -ne "y") { exit 1 }
    } elseif ($mysqlSvc.Status -ne "Running") {
        Start-Service $mysqlSvc.Name
        Start-Sleep -Seconds 3
        Check-Step "MySQL started" { (Get-Service $mysqlSvc.Name).Status -eq "Running" }
    } else {
        Write-Info "MySQL is running"
    }

    # Generate password if needed
    if (-not $DbPassword) {
        $random = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 20 | ForEach-Object { [char]$_ })
        $DbPassword = $random
    }

    # Create database
    Write-Step "Step 3/7  Creating database..."
    Write-Warn "Enter MySQL root password to create the NMS database:"
    $rootPw = Read-Host "  MySQL root password" -AsSecureString
    $rootPwPlain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($rootPw)
    )

    $env:MYSQL_PWD = $rootPwPlain
    $sql = @"
CREATE DATABASE IF NOT EXISTS $DbName CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$DbUser'@'localhost' IDENTIFIED BY '$DbPassword';
CREATE USER IF NOT EXISTS '$DbUser'@'127.0.0.1' IDENTIFIED BY '$DbPassword';
GRANT ALL PRIVILEGES ON $DbName.* TO '$DbUser'@'localhost';
GRANT ALL PRIVILEGES ON $DbName.* TO '$DbUser'@'127.0.0.1';
FLUSH PRIVILEGES;
"@
    try {
        & mysql -u root -e $sql 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Info "Database '$DbName' and user '$DbUser' created"
        } else {
            Write-Warn "MySQL command had errors. Checking if DB already exists..."
        }
    } catch {
        Write-Warn "Could not auto-create database: $_"
    }
    $env:MYSQL_PWD = ""

    # Verify DB connection
    if (Test-MySqlConnection -User $DbUser -Pass $DbPassword -HostName $DbHost -Database $DbName) {
        Write-Info "Database connection verified"
    } else {
        Write-Fail "Cannot connect to database. Check MySQL configuration."
    }

    # ── Step 4: Deploy files ────────────────────────────────────────────
    Write-Step "Step 4/7  Deploying application..."
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    Copy-Item -Recurse -Force "$ProjectDir\backend" $InstallDir
    Copy-Item -Recurse -Force "$ProjectDir\frontend" $InstallDir
    Check-Step "Application files deployed" { Test-Path (Join-Path $InstallDir "backend\app\main.py") }

    # ── Step 5: Python venv ─────────────────────────────────────────────
    Write-Step "Step 5/7  Setting up Python environment..."
    if (-not (Test-Path (Join-Path $InstallDir "venv"))) {
        & $pythonCmd -m venv (Join-Path $InstallDir "venv")
    }
    $venvPython = Join-Path $InstallDir "venv\Scripts\python.exe"
    $venvPip    = Join-Path $InstallDir "venv\Scripts\pip.exe"

    Check-Step "Virtual environment created" { Test-Path $venvPython }

    & $venvPython -m pip install --upgrade pip -q 2>&1 | Out-Null

    Write-Host "  Installing Python packages (this may take a minute)..."
    & $venvPip install -r (Join-Path $InstallDir "backend\requirements.txt") -q 2>&1 | Out-Null
    Check-Step "Python packages installed" { $LASTEXITCODE -eq 0 }

    # ── Step 6: Configuration ───────────────────────────────────────────
    Write-Step "Step 6/7  Creating configuration..."
    $envContent = @"
# NMS Configuration (generated $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
DB_HOST=$DbHost
DB_PORT=$DbPort
DB_USER=$DbUser
DB_PASSWORD=$DbPassword
DB_NAME=$DbName

HOST=0.0.0.0
PORT=$Port
DEBUG=false

SNMP_TIMEOUT=2
SNMP_RETRIES=1

METRICS_COLLECTION_INTERVAL=60
ICMP_CHECK_INTERVAL=30
ALERT_CHECK_INTERVAL=60

SCAN_CONCURRENCY=100
SCAN_PING_TIMEOUT=0.5

METRICS_RETENTION_DAYS=90
"@
    $envContent | Out-File -FilePath (Join-Path $InstallDir ".env") -Encoding UTF8
    Check-Step ".env created" { Test-Path (Join-Path $InstallDir ".env") }

    echo $CurrentVersion | Out-File -FilePath $VersionFile -Encoding UTF8

    # Save credentials
    @"
NMS Database Credentials
========================
Host:     $DbHost`:$DbPort
Database: $DbName
User:     $DbUser
Password: $DbPassword
"@ | Out-File -FilePath (Join-Path $InstallDir ".credentials") -Encoding UTF8
    Write-Info "Credentials saved to $InstallDir\.credentials"

    # ── Step 7: Service ─────────────────────────────────────────────────
    Write-Step "Step 7/7  Installing Windows Service..."

    $nssmPath = $null
    if (Get-Command nssm -ErrorAction SilentlyContinue) {
        $nssmPath = (Get-Command nssm).Source
    } elseif (Test-Path "C:\nssm\win64\nssm.exe") {
        $nssmPath = "C:\nssm\win64\nssm.exe"
    } elseif (Test-Path "$env:ProgramFiles\nssm\win64\nssm.exe") {
        $nssmPath = "$env:ProgramFiles\nssm\win64\nssm.exe"
    }

    if ($nssmPath) {
        Write-Info "NSSM found at $nssmPath"

        # Remove old service
        & $nssmPath stop NMS 2>$null
        & $nssmPath remove NMS confirm 2>$null

        # Create service
        $uvicorn = Join-Path $InstallDir "venv\Scripts\uvicorn.exe"
        & $nssmPath install NMS $uvicorn "app.main:app --host 0.0.0.0 --port $Port --workers 2 --log-level info"
        & $nssmPath set NMS AppDirectory (Join-Path $InstallDir "backend")
        & $nssmPath set NMS DisplayName "NMS - Network Management System"
        & $nssmPath set NMS Description "Network Management System web application"
        & $nssmPath set NMS Start SERVICE_AUTO_START
        & $nssmPath set NMS AppStdout (Join-Path $InstallDir "logs\nms-stdout.log")
        & $nssmPath set NMS AppStderr (Join-Path $InstallDir "logs\nms-stderr.log")
        New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir "logs") | Out-Null

        # Start
        & $nssmPath start NMS
        Start-Sleep -Seconds 5

        $svc = Get-Service -Name "NMS" -ErrorAction SilentlyContinue
        if ($svc -and $svc.Status -eq "Running") {
            Write-Info "NMS service is running via NSSM"
        } else {
            Write-Warn "Service may still be starting. Check: nssm status NMS"
        }
    } else {
        Write-Warn "NSSM not found — using Scheduled Task as fallback"
        Write-Warn "For better management, install NSSM: winget install nssm"

        # Create startup batch
        $batchContent = @"
@echo off
cd /d "$InstallDir\backend"
call "$InstallDir\venv\Scripts\activate.bat"
start "NMS" /MIN "$InstallDir\venv\Scripts\uvicorn.exe" app.main:app --host 0.0.0.0 --port $Port --workers 2 --log-level info
"@
        $batchContent | Out-File -FilePath (Join-Path $InstallDir "start-nms.bat") -Encoding ASCII

        $taskName = "NMS-NetworkManagementSystem"
        $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        if ($existing) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }

        $action = New-ScheduledTaskAction -Execute (Join-Path $InstallDir "start-nms.bat")
        $trigger = New-ScheduledTaskTrigger -AtStartup
        $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
        $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1)

        Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "NMS Network Management System" | Out-Null
        Start-ScheduledTask -TaskName $taskName
        Write-Info "Scheduled Task '$taskName' created and started"
    }

    # ── FINISH ──────────────────────────────────────────────────────────
    Write-Host ""
    Write-Host "╔══════════════════════════════════════════════════════╗" -ForegroundColor Green
    Write-Host "║     ✓  NMS Installation Complete!                    ║" -ForegroundColor Green
    Write-Host "╚══════════════════════════════════════════════════════╝" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Web Interface:  http://$env:COMPUTERNAME`:$Port"
    Write-Host "  API Docs:       http://localhost:$Port/docs"
    Write-Host "  Health Check:   http://localhost:$Port/api/health"
    Write-Host ""
    Write-Host "  Database:       $DbHost`:$DbPort/$DbName"
    Write-Host "  DB User:        $DbUser"
    Write-Host "  DB Password:    $DbPassword"
    Write-Host "  Saved to:       $InstallDir\.credentials"
    Write-Host ""
}

# ═════════════════════════════════════════════════════════════════════════════
# UNINSTALL
# ═════════════════════════════════════════════════════════════════════════════

function Start-Uninstall {
    Write-Banner

    Write-Host "WARNING: This will remove NMS from this system." -ForegroundColor Red
    Write-Host ""
    Write-Host "  The following will be removed:"
    Write-Host "    - NMS Windows Service / Scheduled Task"
    Write-Host "    - Application files in $InstallDir"
    Write-Host ""
    Write-Host "  The MySQL database '$DbName' will NOT be removed." -ForegroundColor Yellow
    Write-Host ""

    $confirm = Read-Host "  Type 'DELETE' to confirm uninstall"
    if ($confirm -ne "DELETE") { Write-Host "Aborted."; exit 0 }

    Write-Host ""

    # 1. Remove NSSM service
    Write-Step "Removing Windows Service..."
    $nssmPath = $null
    if (Get-Command nssm -ErrorAction SilentlyContinue) {
        $nssmPath = (Get-Command nssm).Source
    } elseif (Test-Path "C:\nssm\win64\nssm.exe") {
        $nssmPath = "C:\nssm\win64\nssm.exe"
    }
    if ($nssmPath) {
        & $nssmPath stop NMS 2>$null
        & $nssmPath remove NMS confirm 2>$null
        Write-Info "NSSM service removed"
    }

    # 2. Remove Scheduled Task
    $task = Get-ScheduledTask -TaskName "NMS-NetworkManagementSystem" -ErrorAction SilentlyContinue
    if ($task) {
        Unregister-ScheduledTask -TaskName "NMS-NetworkManagementSystem" -Confirm:$false
        Write-Info "Scheduled Task removed"
    }

    # 3. Remove firewall rule
    $fwRule = Get-NetFirewallRule -DisplayName "NMS Web Interface" -ErrorAction SilentlyContinue
    if ($fwRule) {
        Remove-NetFirewallRule -DisplayName "NMS Web Interface" -Confirm:$false
        Write-Info "Firewall rule removed"
    }

    # 4. Remove files
    Write-Step "Removing files..."
    if (Test-Path $InstallDir) {
        Remove-Item -Recurse -Force $InstallDir
        Write-Info "$InstallDir removed"
    }

    Write-Host ""
    Write-Host "╔══════════════════════════════════════════════════════╗" -ForegroundColor Green
    Write-Host "║     ✓  NMS Uninstalled                               ║" -ForegroundColor Green
    Write-Host "╚══════════════════════════════════════════════════════╝" -ForegroundColor Green
    Write-Host ""
}

# ═════════════════════════════════════════════════════════════════════════════
# UPGRADE
# ═════════════════════════════════════════════════════════════════════════════

function Start-Upgrade {
    Write-Banner

    Write-Host "NMS Upgrade" -ForegroundColor Yellow
    Write-Host ""

    if (-not (Test-Path (Join-Path $InstallDir ".env"))) {
        Write-Fail "NMS is not installed at $InstallDir. Run install first."
    }

    $oldVer = "unknown"
    if (Test-Path $VersionFile) { $oldVer = Get-Content $VersionFile }

    Write-Host "  Current version: $oldVer"
    Write-Host "  New version:     $CurrentVersion"
    Write-Host ""

    $confirm = Read-Host "  Continue? [Y/n]"
    if ($confirm -eq "n") { Write-Host "Aborted."; exit 0 }

    Write-Host ""

    # 1. Stop
    Write-Step "Stopping NMS..."
    $nssmPath = $null
    if (Get-Command nssm -ErrorAction SilentlyContinue) { $nssmPath = (Get-Command nssm).Source }
    elseif (Test-Path "C:\nssm\win64\nssm.exe") { $nssmPath = "C:\nssm\win64\nssm.exe" }
    if ($nssmPath) {
        & $nssmPath stop NMS 2>$null
        Write-Info "Service stopped"
    }
    Stop-ScheduledTask -TaskName "NMS-NetworkManagementSystem" -ErrorAction SilentlyContinue

    # 2. Backup
    Write-Step "Backing up configuration..."
    $backupFile = Join-Path $InstallDir ".env.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Copy-Item (Join-Path $InstallDir ".env") $backupFile
    Write-Info "Config backed up to $backupFile"

    # 3. Update files
    Write-Step "Updating application files..."
    Copy-Item -Recurse -Force "$ProjectDir\backend" $InstallDir
    Copy-Item -Recurse -Force "$ProjectDir\frontend" $InstallDir
    Check-Step "Files updated" { Test-Path (Join-Path $InstallDir "backend\app\main.py") }

    # 4. Update deps
    Write-Step "Updating dependencies..."
    $venvPip = Join-Path $InstallDir "venv\Scripts\pip.exe"
    & $venvPip install -r (Join-Path $InstallDir "backend\requirements.txt") -q 2>&1 | Out-Null
    Write-Info "Dependencies updated"

    # 5. Update version
    echo $CurrentVersion | Out-File -FilePath $VersionFile -Encoding UTF8

    # 6. Restart
    Write-Step "Restarting NMS..."
    if ($nssmPath) {
        & $nssmPath start NMS
        Start-Sleep -Seconds 5
        if ((Get-Service -Name "NMS" -ErrorAction SilentlyContinue).Status -eq "Running") {
            Write-Info "NMS restarted successfully"
        }
    } else {
        Start-ScheduledTask -TaskName "NMS-NetworkManagementSystem"
        Write-Info "Scheduled task started"
    }

    Write-Host ""
    Write-Host "╔══════════════════════════════════════════════════════╗" -ForegroundColor Green
    Write-Host "║     ✓  NMS Upgraded to v$CurrentVersion                          ║" -ForegroundColor Green
    Write-Host "╚══════════════════════════════════════════════════════╝" -ForegroundColor Green
    Write-Host ""
}

# ═════════════════════════════════════════════════════════════════════════════
# MENU
# ═════════════════════════════════════════════════════════════════════════════

function Show-Menu {
    Write-Banner
    Write-Host "  1) Install        — Fresh installation of NMS"
    Write-Host "  2) Uninstall      — Remove NMS from this system"
    Write-Host "  3) Upgrade        — Update to latest version"
    Write-Host "  4) Status         — Show current status"
    Write-Host "  5) Exit"
    Write-Host ""
    $choice = Read-Host "  Select [1-5]"

    switch ($choice) {
        "1" { Start-Install }
        "2" { Start-Uninstall }
        "3" { Start-Upgrade }
        "4" { Show-Status }
        "5" { Write-Host "Bye."; exit 0 }
        default { Write-Host "Invalid choice."; Show-Menu }
    }
}

# ═════════════════════════════════════════════════════════════════════════════
# MAIN
# ═════════════════════════════════════════════════════════════════════════════

switch ($Action) {
    "install"   { Start-Install }
    "uninstall" { Start-Uninstall }
    "upgrade"   { Start-Upgrade }
    "status"    { Show-Status }
    "menu"      { Show-Menu }
    default     { Show-Menu }
}
