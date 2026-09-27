$ErrorActionPreference = "Stop"
Write-Host "Starting Waimai Order..." -ForegroundColor Green
& "$PSScriptRoot\mvnw.cmd" spring-boot:run
