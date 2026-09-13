# Starts ringback_server.ps1 detached with startup logging
$Root = "C:\Users\user\Documents\call-e"
$Log = Join-Path $Root "server_startup.log"
"START ATTEMPT $(Get-Date -Format o)" | Out-File $Log -Encoding utf8
try {
  powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "ringback_server.ps1") 2>&1 | Out-File $Log -Append -Encoding utf8
} catch {
  ("FATAL " + $_.Exception.Message) | Out-File $Log -Append -Encoding utf8
}
