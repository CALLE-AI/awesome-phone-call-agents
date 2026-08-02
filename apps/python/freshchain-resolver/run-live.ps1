param(
  [string]$BaseUrl = "https://api.heycall-e.com",
  [int]$Port = 8080
)

$secureKey = Read-Host "Paste your CALL-E Developer API key" -AsSecureString
$keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)

try {
  $tokenBytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($tokenBytes)
  $liveToken = ([BitConverter]::ToString($tokenBytes)).Replace("-", "")
  $env:CALLE_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
  $env:CALLE_BASE_URL = $BaseUrl
  $env:CALLE_LIVE_CALLS_ENABLED = "true"
  $env:CALLE_TIMEOUT_SECONDS = "600"
  $env:FRESHCHAIN_HOST = "127.0.0.1"
  $env:FRESHCHAIN_PORT = [string]$Port
  $env:FRESHCHAIN_LIVE_TOKEN = $liveToken
  Write-Host "Starting FreshChain at http://127.0.0.1:$Port"
  Write-Host "The API key is process-local and is not written to disk."
  Write-Host "Use this process-local Bearer token for state-changing API requests:"
  Write-Host $liveToken
  & .\.venv\Scripts\python.exe app.py
}
finally {
  $env:CALLE_API_KEY = $null
  $env:FRESHCHAIN_LIVE_TOKEN = $null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
}
