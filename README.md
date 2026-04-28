# Adaptivní výuková platforma

**Stack:** FastAPI, Azure Table/Blob Storage, Azure Container Instances, Azure Functions, GitHub Models (GPT-4o-mini)

---

## Požadavky

- Python 3.11+
- Node.js + Azure Functions Core Tools: `npm install -g azure-functions-core-tools@4`
- Git

---

## Instalace

```powershell
git clone https://github.com/TobiasKoza/AdaptiveAIPlatform.git
cd AdaptiveAIPlatform
```

### Backend

```powershell
cd backend-api
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
cd ..
```

### Azure Functions

```powershell
cd functions-app
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
cd ..
```

---

## Konfigurace

Vložit `.env` do složky `backend-api\`. misto `.env.example`

---

## Spuštění
>`start.cmd` -> **Spustit jako správce**, jinak nemusí správně nastartovat všechny procesy.
```powershell
# Terminál 1 — Backend
cd backend-api
.venv\Scripts\activate
uvicorn app.main:app --reload --port 8000
```

```powershell
# Terminál 2 — Azure Functions
cd functions-app
.venv\Scripts\activate
func start
```

Při prvním spuštění func start vyber šipkami **Python** a potvrď Enter.

```powershell
# Terminál 3 — Frontend
cd frontend
python -m http.server 5500
```

---

## Přístup

| | URL |
|---|---|
| Student / přihlášení | http://127.0.0.1:5500/index.html |
| Učitelský portál | http://127.0.0.1:5500/teacher.html |
| API dokumentace | http://127.0.0.1:8000/docs |


---

## Architektura

```
frontend/        HTML/JS, port 5500
backend-api/     FastAPI, port 8000
functions-app/   Azure Functions — spouštění ACI kontejnerů (Kali Linux)
```

Data jsou v Azure — není potřeba lokální databáze.
