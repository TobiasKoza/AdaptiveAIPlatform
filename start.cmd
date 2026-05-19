@echo off
chcp 65001 >nul

set ROOT=%~dp0

start "Azure Functions" cmd /k "cd /d "%ROOT%functions-app" && .\.venv\Scripts\activate && func start"
start "Backend API" cmd /k "cd /d "%ROOT%backend" && .\.venv\Scripts\activate && python -m uvicorn app.main:app --reload"
start "Frontend" cmd /k "cd /d "%ROOT%frontend" && python -m http.server 5500"

exit