import uuid
from fastapi import APIRouter, Depends, HTTPException
from typing import Any
from azure.core.exceptions import ResourceExistsError

from app.auth import get_current_user
from app.storage import get_groups_table, get_users_table, utc_now_iso
from app.models.schemas import GroupCreateRequest

router = APIRouter(prefix="/groups", tags=["Groups"])

@router.post("")
def create_group(payload: GroupCreateRequest, current_user=Depends(get_current_user)) -> dict[str, Any]:
    # Oprávnění: Učitel nebo Admin
    if current_user.get("global_role") not in ["teacher", "admin"]:
        raise HTTPException(status_code=403, detail="Pouze učitel nebo admin může vytvářet skupiny.")
    
    groups_table = get_groups_table()

    # Ochrana proti duplicitním názvům skupin
    for existing in groups_table.list_entities():
        if existing.get("title", "").strip().lower() == payload.title.strip().lower():
            raise HTTPException(status_code=409, detail=f"Skupina s názvem \"{payload.title}\" již existuje.")

    # AUTOGENERACE ID: Vytvoří např. "grp-f7a9b2c1"
    generated_group_id = f"grp-{uuid.uuid4().hex[:8]}"

    entity = {
        "PartitionKey": "GROUP",
        "RowKey": generated_group_id,
        "group_id": generated_group_id,
        "title": payload.title,
        "description": payload.description,
        "status": payload.status,
        "created_by": current_user["user_id"],
        "created_at": utc_now_iso()
    }
    
    try:
        groups_table.create_entity(entity=entity)
    except ResourceExistsError:
        raise HTTPException(status_code=409, detail="Nepodařilo se vytvořit skupinu.")
        
    return {"message": "Skupina úspěšně vytvořena", "groupId": generated_group_id}

@router.get("")
def list_groups(current_user=Depends(get_current_user)) -> list[dict[str, Any]]:
    # Oprávnění: Učitel nebo Admin vidí skupiny
    if current_user.get("global_role") not in ["teacher", "admin"]:
         raise HTTPException(status_code=403, detail="Nemáte oprávnění prohlížet skupiny.")
         
    table = get_groups_table()
    return [dict(e) for e in table.list_entities()]

@router.delete("/{group_id}")
def delete_group(group_id: str, current_user=Depends(get_current_user)):
    if current_user.get("global_role") not in ["teacher", "admin"]:
        raise HTTPException(status_code=403, detail="Nemáte oprávnění mazat skupiny.")
    
    groups_table = get_groups_table()
    groups_table.delete_entity(partition_key="GROUP", row_key=group_id)

    # Odstraň group_id ze všech uživatelů
    users_table = get_users_table()
    for user in users_table.list_entities():
        if user.get("PartitionKey") != "USER":
            continue
        ids = user.get("group_ids", [])
        if isinstance(ids, str):
            ids = [i.strip() for i in ids.split(",") if i.strip()]
        if group_id in ids:
            ids.remove(group_id)
            user["group_ids"] = ids
            users_table.update_entity(user)

    return {"message": f"Skupina {group_id} byla smazána."}

from pydantic import BaseModel
from app.storage import get_groupmembers_table

class GroupRenameRequest(BaseModel):
    title: str

class GroupMemberRequest(BaseModel):
    user_id: str

@router.put("/{group_id}")
def rename_group(group_id: str, payload: GroupRenameRequest, current_user=Depends(get_current_user)):
    if current_user.get("global_role") not in ["teacher", "admin"]:
        raise HTTPException(status_code=403, detail="Nemáte oprávnění.")
    groups_table = get_groups_table()
    try:
        group = groups_table.get_entity(partition_key="GROUP", row_key=group_id)
        group["title"] = payload.title
        groups_table.update_entity(group)
        return {"message": "Skupina přejmenována."}
    except Exception:
        raise HTTPException(status_code=404, detail="Skupina nenalezena.")

@router.post("/{group_id}/members")
def add_group_member(group_id: str, payload: GroupMemberRequest, current_user=Depends(get_current_user)):
    if current_user.get("global_role") not in ["teacher", "admin"]:
        raise HTTPException(status_code=403, detail="Nemáte oprávnění.")
    gm_table = get_groupmembers_table()
    gm_table.upsert_entity({
        "PartitionKey": group_id,
        "RowKey": payload.user_id,
        "group_id": group_id,
        "user_id": payload.user_id,
        "joined_at": utc_now_iso()
    })
    return {"message": "Student přidán do skupiny."}

@router.delete("/{group_id}/members/{user_id}")
def remove_group_member(group_id: str, user_id: str, current_user=Depends(get_current_user)):
    if current_user.get("global_role") not in ["teacher", "admin"]:
        raise HTTPException(status_code=403, detail="Nemáte oprávnění.")
    gm_table = get_groupmembers_table()
    try:
        gm_table.delete_entity(partition_key=group_id, row_key=user_id)
    except Exception:
        pass
    return {"message": "Student odebrán ze skupiny."}