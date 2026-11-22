@echo off
setlocal
cd /d "%~dp0"

if exist "dist\Blueprint Studio (Rust).exe" goto run
if exist "src-tauri\target\release\blueprint-studio.exe" goto runrelease

where cargo >nul 2>nul
if errorlevel 1 goto nocargo

echo Compilation de Blueprint Studio (premier lancement uniquement)...
cargo run --release --manifest-path src-tauri\Cargo.toml
exit /b %errorlevel%

:runrelease
start "" "%~dp0src-tauri\target\release\blueprint-studio.exe"
exit /b 0

:run
start "" "%~dp0dist\Blueprint Studio (Rust).exe"
exit /b 0

:nocargo
echo.
echo Blueprint Studio n'est pas encore compile et Rust n'est pas installe.
echo Installez Rust depuis https://rustup.rs puis relancez ce fichier,
echo ou utilisez directement "Blueprint Studio (Rust) Setup.exe".
pause
exit /b 1
