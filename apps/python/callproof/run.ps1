$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

if (-not (Test-Path ".venv")) {
    python -m venv .venv
}

& .\.venv\Scripts\python.exe -m pip install -r requirements.txt

Write-Host ""
Write-Host "CallProof starting at http://127.0.0.1:8000" -ForegroundColor Green
Write-Host "Recorded live proof and deterministic scenario work without credentials."
if (-not $env:CALLE_API_KEY) {
    Write-Host "CALLE_API_KEY is not set; Developer API live mode will remain unavailable." -ForegroundColor Yellow
}
Write-Host ""

& .\.venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8000 --reload
