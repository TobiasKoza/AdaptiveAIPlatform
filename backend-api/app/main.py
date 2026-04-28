from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from typing import Any
from dotenv import load_dotenv

from app.auth import get_current_user
from app.routers import courses, labs, assignments, submissions, users, groups, materials, ai, analytics

load_dotenv()

app = FastAPI(title="AdaptivePlatform MVP API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5500",
        "http://localhost:5500",
        "http://127.0.0.1:3000",
        "http://localhost:3000",
        "http://127.0.0.1:8080",
        "http://localhost:8080",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(courses.router)
app.include_router(labs.router)
app.include_router(assignments.router)
app.include_router(submissions.router)
app.include_router(users.router)  
app.include_router(groups.router)
app.include_router(materials.router)
app.include_router(ai.router)
app.include_router(analytics.router)

@app.get("/")
def root() -> dict[str, str]:
    return {"message": "AdaptivePlatform MVP API is running."}

@app.get("/me")
def me(current_user=Depends(get_current_user)) -> dict[str, Any]:
    """
    Vrátí identitu aktuálního mock uživatele.
    Tento endpoint je první kontrola, že backend už umí rozlišit,
    kdo je student a kdo učitel.
    """
    return {
        "userId": current_user.get("user_id"),
        "displayName": current_user.get("display_name"),
        "email": current_user.get("email"),
        "globalRole": current_user.get("global_role"),
        "accountStatus": current_user.get("account_status"),
        "mockPassword": current_user.get("mock_password", "")
    }