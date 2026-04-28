from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
# TENTO ŘÁDEK MUSÍŠ PŘIDAT:
from azure.data.tables import UpdateMode
from azure.core.exceptions import ResourceNotFoundError
from app.auth import get_current_user
from app.storage import get_users_table, get_groups_table, get_courses_table, get_groupmembers_table, get_coursemembers_table, utc_now_iso
from app.models.schemas import UserCreateRequest, UserCreateResponse
from app.services.graph import graph_service
from app.auth import get_current_user

router = APIRouter(prefix="/users", tags=["Users"])

@router.post("", response_model=UserCreateResponse)
def create_user(payload: UserCreateRequest, current_user=Depends(get_current_user)):
    # 1. Autorizace: Jen teacher nebo admin
    if current_user.get("global_role") not in ["teacher", "admin"]:
        raise HTTPException(status_code=403, detail="Nemáte oprávnění vytvářet uživatele.")

    users_table = get_users_table()
    user_id = payload.email # Pro jednoduchost MVP = email

    # Ochrana proti duplicitám
    try:
        if users_table.get_entity(partition_key="USER", row_key=user_id):
            raise HTTPException(status_code=409, detail="Uživatel s tímto e-mailem již existuje.")
    except Exception:
        pass # Nenalezeno, můžeme pokračovat

    # 2. Microsoft Graph vrstva (v MVP vrací mock)
    entra_result = graph_service.create_entra_user(payload.email, payload.display_name)

    # 3. Zápis do lokálního aplikačního profilu
    user_entity = {
        "PartitionKey": "USER",
        "RowKey": user_id,
        "user_id": user_id,
        "email": payload.email,
        "display_name": payload.display_name,
        "global_role": payload.global_role,
        "account_status": "pending_activation",
        "identity_type": "entra_id" if graph_service.is_enabled else "mock",
        "external_entra_user_id": entra_result["entra_user_id"],
        "is_active": True,
        "created_at": utc_now_iso()
    }
    users_table.create_entity(entity=user_entity)

    # 4. VOLITELNÉ Přiřazení do Skupin
    if payload.group_ids:
        groupmembers = get_groupmembers_table()
        for g_id in payload.group_ids:
            groupmembers.upsert_entity({
                "PartitionKey": g_id.strip(),
                "RowKey": user_id,
                "group_id": g_id.strip(),
                "user_id": user_id,
                "joined_at": utc_now_iso()
            })

    # 5. VOLITELNÉ Přiřazení do Kurzů (Zcela nezávisle)
    if payload.course_ids:
        coursemembers = get_coursemembers_table()
        for c_id in payload.course_ids:
            coursemembers.upsert_entity({
                "PartitionKey": c_id.strip(),
                "RowKey": user_id,
                "course_id": c_id.strip(),
                "user_id": user_id,
                "role_in_course": payload.global_role, # Zdědí globální roli
                "joined_at": utc_now_iso()
            })

    return {
        "userId": user_id,
        "email": payload.email,
        "tempPassword": entra_result["temp_password"],
        "externalEntraUserId": entra_result["entra_user_id"]
    }

@router.get("")
def list_users(current_user=Depends(get_current_user)):
    if current_user.get("global_role") not in ["teacher", "admin"]:
        raise HTTPException(status_code=403, detail="Nemáte oprávnění.")
    
    users_table = get_users_table()
    gm_table = get_groupmembers_table()
    cm_table = get_coursemembers_table()
    
    all_users = [dict(e) for e in users_table.list_entities() if e.get("PartitionKey") == "USER" and e.get("global_role") != "admin"]
    
    for u in all_users:
        user_id = u["user_id"]
        
        # 2. Vracíme čistě ID skupin bez překladu na názvy
        try:
            user_groups = gm_table.query_entities(query_filter=f"RowKey eq '{user_id}'")
            u["group_ids"] = list(set([gm["PartitionKey"] for gm in user_groups]))
        except:
            u["group_ids"] = []
            
        # 3. Vracíme čistě ID kurzů bez překladu na názvy
        try:
            user_courses = cm_table.query_entities(query_filter=f"RowKey eq '{user_id}'")
            u["course_ids"] = list(set([cm["PartitionKey"] for cm in user_courses]))
        except:
            u["course_ids"] = []
            
    return all_users

@router.delete("/{user_id}")
def delete_user(user_id: str, current_user=Depends(get_current_user)):
    # Mazat může jen učitel nebo admin
    if current_user.get("global_role") not in ["teacher", "admin"]:
        raise HTTPException(status_code=403, detail="Nemáte oprávnění mazat uživatele.")
    
    users_table = get_users_table()
    # V Azure Table Storage mažeme podle PartitionKey a RowKey
    users_table.delete_entity(partition_key="USER", row_key=user_id)
    return {"message": f"Uživatel {user_id} byl smazán."}

class PasswordChangeRequest(BaseModel):
    new_password: str

@router.post("/change-password")
def change_password(payload: PasswordChangeRequest, current_user=Depends(get_current_user)):
    users_table = get_users_table()
    
    # 1. Najdeme kompletní záznam uživatele
    entity = users_table.get_entity(partition_key="USER", row_key=current_user["user_id"])
    
    # 2. Nastavíme mu nové heslo a změníme status na aktivní
    entity["mock_password"] = payload.new_password
    entity["account_status"] = "active"
    
    # 3. Uložíme zpět do databáze
    users_table.update_entity(entity=entity)
    
    return {"message": "Heslo úspěšně změněno."}

class UserRenameRequest(BaseModel):
    display_name: str

@router.put("/{user_id}")
def rename_user(user_id: str, payload: UserRenameRequest, current_user=Depends(get_current_user)):
    # Autorizace: Pouze učitel nebo admin
    if current_user.get("global_role") not in ["teacher", "admin"]:
        raise HTTPException(status_code=403, detail="Nemáte oprávnění.")
    
    users_table = get_users_table()
    try:
        # 1. Najdeme entitu v DB
        entity = users_table.get_entity(partition_key="USER", row_key=user_id)
        # 2. Aktualizujeme jméno
        entity["display_name"] = payload.display_name
        # 3. Uložíme zpět
        users_table.update_entity(entity=entity)
        return {"message": "Uživatel přejmenován."}
    except Exception:
        raise HTTPException(status_code=404, detail="Uživatel nenalezen.")
    
    # --- NOVÝ ENDPOINT PRO ÚPRAVU VLASTNÍHO JMÉNA ---

class ProfileUpdate(BaseModel):
    display_name: str

@router.post("/update-profile")
def update_own_profile(
    profile: ProfileUpdate,
    current_user: dict = Depends(get_current_user)
):
    """
    Umožní přihlášenému uživateli změnit své zobrazované jméno.
    """
    user_email = current_user.get("email") # Vytaženo bezpečně z tokenu/headeru přes auth.py
    
    if not user_email:
        raise HTTPException(status_code=400, detail="Nelze určit uživatele.")

    users_table = get_users_table()
    
    try:
        # 1. Načteme uživatele z DB
        user = users_table.get_entity(partition_key="USER", row_key=user_email)
        
        # 2. Aktualizujeme jméno
        user["display_name"] = profile.display_name
        
        # 3. Uložíme zpět
        users_table.update_entity(mode=UpdateMode.REPLACE, entity=user)
        
        return {"message": "Profil úspěšně aktualizován."}
        
    except ResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Uživatel nenalezen.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))