@echo off
setlocal enabledelayedexpansion

echo ======================================
echo EdgeChat Local Deploy to Cloudflare
echo ======================================
echo.

REM Check required environment variables
if "%CLOUDFLARE_API_TOKEN%"=="" (
    echo ❌ Error: Missing required environment variable: CLOUDFLARE_API_TOKEN
    echo.
    echo Please set the following environment variables:
    echo   set CLOUDFLARE_API_TOKEN=your_api_token
    echo   set CLOUDFLARE_ACCOUNT_ID=your_account_id
    echo.
    echo Optional environment variables:
    echo   set EDGECHAT_ADMIN_USERNAME=admin
    echo   set EDGECHAT_ADMIN_PASSWORD=your_password
    echo   set EDGECHAT_ADMIN_DISPLAY_NAME=Administrator
    exit /b 1
)

if "%CLOUDFLARE_ACCOUNT_ID%"=="" (
    echo ❌ Error: Missing required environment variable: CLOUDFLARE_ACCOUNT_ID
    echo.
    echo Please set the following environment variables:
    echo   set CLOUDFLARE_API_TOKEN=your_api_token
    echo   set CLOUDFLARE_ACCOUNT_ID=your_account_id
    echo.
    echo Optional environment variables:
    echo   set EDGECHAT_ADMIN_USERNAME=admin
    echo   set EDGECHAT_ADMIN_PASSWORD=your_password
    echo   set EDGECHAT_ADMIN_DISPLAY_NAME=Administrator
    exit /b 1
)

echo ✅ Environment variables check passed
echo.

REM Step 1: Install dependencies
echo 📦 Installing dependencies...
call npm ci
if errorlevel 1 (
    echo ❌ Failed to install dependencies
    exit /b 1
)
echo.

REM Step 2: Build frontend assets
echo 🔨 Building frontend assets...
call npm run build:frontend
if errorlevel 1 (
    echo ❌ Failed to build frontend assets
    exit /b 1
)
echo.

REM Step 3: Ensure Cloudflare resources (D1, KV)
echo ☁️  Ensuring Cloudflare resources...
node .github/scripts/ensure-cloudflare-resources.mjs > "%TEMP%\cf-resources-output.txt"
type "%TEMP%\cf-resources-output.txt"

REM Parse outputs from the script
for /f "tokens=*" %%a in ('findstr "[output] d1_database_name=" "%TEMP%\cf-resources-output.txt"') do (
    for /f "tokens=2 delims==" %%b in ("%%a") do set "d1_database_name=%%b"
)
for /f "tokens=*" %%a in ('findstr "[output] d1_database_id=" "%TEMP%\cf-resources-output.txt"') do (
    for /f "tokens=2 delims==" %%b in ("%%a") do set "d1_database_id=%%b"
)
for /f "tokens=*" %%a in ('findstr "[output] d1_created=" "%TEMP%\cf-resources-output.txt"') do (
    for /f "tokens=2 delims==" %%b in ("%%a") do set "d1_created=%%b"
)
for /f "tokens=*" %%a in ('findstr "[output] kv_namespace_id=" "%TEMP%\cf-resources-output.txt"') do (
    for /f "tokens=2 delims==" %%b in ("%%a") do set "kv_namespace_id=%%b"
)

echo.

REM Step 4: Generate wrangler config
echo ⚙️  Generating wrangler config...
copy wrangler.example.toml wrangler.toml > nul
powershell -Command "(Get-Content wrangler.toml) -replace 'YOUR_D1_DATABASE_ID_HERE', '%d1_database_id%' | Set-Content wrangler.toml.tmp; Move-Item -Force wrangler.toml.tmp wrangler.toml"
powershell -Command "(Get-Content wrangler.toml) -replace 'YOUR_KV_NAMESPACE_ID_HERE', '%kv_namespace_id%' | Set-Content wrangler.toml.tmp; Move-Item -Force wrangler.toml.tmp wrangler.toml"
echo ✅ Generated wrangler.toml
echo.

REM Step 5: Initialize D1 schema (if database was just created)
if "%d1_created%"=="true" (
    echo 💾 Initializing D1 database schema...
    call npx wrangler d1 execute "%d1_database_name%" --remote --file worker/schema.sql
    if errorlevel 1 (
        echo ❌ Failed to initialize D1 schema
        exit /b 1
    )
    echo ✅ D1 schema initialized
    echo.
)

REM Step 6: Generate admin bootstrap SQL (optional)
if not "%EDGECHAT_ADMIN_USERNAME%"=="" (
    if not "%EDGECHAT_ADMIN_PASSWORD%"=="" (
        echo 👤 Generating admin user bootstrap SQL...
        node .github/scripts/generate-admin-bootstrap-sql.mjs
        
        echo 📝 Applying admin user to database...
        call npx wrangler d1 execute "%d1_database_name%" --remote --file .tmp/edgechat-admin-upsert.sql
        if errorlevel 1 (
            echo ❌ Failed to apply admin user
            exit /b 1
        )
        echo ✅ Admin user created/updated
        echo.
    )
)

REM Step 7: Deploy worker
echo 🚀 Deploying Worker to Cloudflare...
call npx wrangler deploy
if errorlevel 1 (
    echo ❌ Failed to deploy Worker
    exit /b 1
)
echo.

echo ======================================
echo ✅ Deployment completed successfully!
echo ======================================
echo.
echo Your EdgeChat app is now live on Cloudflare Workers.
echo.
