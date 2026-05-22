# Start SkinSense frontend
Set-Location "$PSScriptRoot\frontend"

if (-not (Test-Path ".env.local")) {
    Copy-Item ".env.local.example" ".env.local"
}

npm run dev
