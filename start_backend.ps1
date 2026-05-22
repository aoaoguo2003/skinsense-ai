# Start SkinSense backend
Set-Location "$PSScriptRoot\backend"

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "Created .env from .env.example - please fill in your API keys!" -ForegroundColor Yellow
}

& ".\venv\Scripts\Activate.ps1"
pip install -r requirements.txt --quiet
uvicorn main:app --reload --port 8000
