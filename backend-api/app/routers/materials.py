import os
import uuid
from typing import Any
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import JSONResponse
from azure.storage.blob import BlobServiceClient, generate_blob_sas, BlobSasPermissions
from azure.core.exceptions import ResourceNotFoundError
from datetime import datetime, timezone
import urllib.parse

from app.auth import get_current_user, require_course_membership
from app.storage import get_table_service, ensure_table, utc_now_iso

router = APIRouter(tags=["Materials"])

# Povolené typy souborů a max velikost (20 MB)
ALLOWED_EXTENSIONS = {"pdf", "png", "jpg", "jpeg", "docx", "pptx", "mp4", "txt", "md"}
MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB

def get_blob_service() -> BlobServiceClient:
    conn = os.getenv("BLOB_CONNECTION_STRING")
    if not conn:
        raise RuntimeError("Chybí BLOB_CONNECTION_STRING v .env")
    return BlobServiceClient.from_connection_string(conn)

def get_materials_table():
    return ensure_table(os.getenv("MATERIALS_TABLE_NAME", "coursematerials"))

def get_blob_container_name() -> str:
    return os.getenv("BLOB_CONTAINER_MATERIALS", "course-materials")


@router.post("/courses/{course_id}/materials")
async def upload_material(
    course_id: str,
    file: UploadFile = File(...),
    current_user=Depends(get_current_user)
) -> JSONResponse:
    # Oprávnění: jen učitel nebo admin
    membership = require_course_membership(course_id, current_user["user_id"])
    if membership.get("role_in_course") not in ["teacher", "assistant"] and current_user.get("global_role") != "admin":
        raise HTTPException(status_code=403, detail="Pouze učitel může nahrávat materiály.")

    # Kontrola přípony
    original_name = file.filename or "soubor"
    ext = original_name.rsplit(".", 1)[-1].lower() if "." in original_name else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Nepodporovaný typ souboru. Povoleno: {', '.join(ALLOWED_EXTENSIONS)}")

    # Přečtení obsahu a kontrola velikosti
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="Soubor je příliš velký. Maximum je 20 MB.")

    # Unikátní název blobu: {courseId}/{uuid}.{ext}
    file_id = uuid.uuid4().hex[:12]
    blob_name = f"{course_id}/{file_id}.{ext}"

    # Nahrání do Blob Storage
    blob_service = get_blob_service()
    container_name = get_blob_container_name()
    blob_client = blob_service.get_blob_client(container=container_name, blob=blob_name)

    blob_client.upload_blob(content, overwrite=True)

    # Zápis metadat do Table Storage
    table = get_materials_table()
    uploaded_at = utc_now_iso()
    entity = {
        "PartitionKey": course_id,
        "RowKey": file_id,
        "fileId": file_id,
        "courseId": course_id,
        "originalName": original_name,
        "blobName": blob_name,
        "extension": ext,
        "sizeBytes": len(content),
        "uploadedBy": current_user["user_id"],
        "uploadedAt": uploaded_at,
    }
    table.create_entity(entity=entity)

    return JSONResponse(status_code=201, content={
        "message": "Soubor úspěšně nahrán.",
        "fileId": file_id,
        "originalName": original_name,
        "sizeBytes": len(content),
        "uploadedAt": uploaded_at,
    })


@router.get("/courses/{course_id}/materials")
def list_materials(
    course_id: str,
    current_user=Depends(get_current_user)
) -> list[dict[str, Any]]:
    # Oprávnění: člen kurzu (student i učitel)
    require_course_membership(course_id, current_user["user_id"])

    table = get_materials_table()
    results = []
    for entity in table.query_entities(query_filter=f"PartitionKey eq '{course_id}'"):
        results.append({
            "fileId": entity.get("fileId"),
            "originalName": entity.get("originalName"),
            "extension": entity.get("extension"),
            "sizeBytes": entity.get("sizeBytes"),
            "uploadedBy": entity.get("uploadedBy"),
            "uploadedAt": entity.get("uploadedAt"),
        })
    results.sort(key=lambda x: x.get("uploadedAt", ""), reverse=True)
    return results


@router.get("/courses/{course_id}/materials/{file_id}/download")
def download_material(
    course_id: str,
    file_id: str,
    current_user=Depends(get_current_user)
) -> dict[str, Any]:
    # Oprávnění: člen kurzu
    require_course_membership(course_id, current_user["user_id"])

    table = get_materials_table()
    try:
        entity = table.get_entity(partition_key=course_id, row_key=file_id)
    except ResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Soubor nebyl nalezen.")

    blob_name = entity.get("blobName")
    original_name = entity.get("originalName", "stazeny_soubor")
    container_name = get_blob_container_name()

    # Bezpečný encoding názvu (ochrana proti mezerám a diakritice)
    safe_name = urllib.parse.quote(original_name)

    # Vygeneruj SAS token platný 30 minut
    blob_service = get_blob_service()
    account_name = blob_service.account_name
    account_key = blob_service.credential.account_key

    sas_token = generate_blob_sas(
        account_name=account_name,
        container_name=container_name,
        blob_name=blob_name,
        account_key=account_key,
        permission=BlobSasPermissions(read=True),
        expiry=datetime.now(timezone.utc) + timedelta(minutes=30),
        content_disposition=f"attachment; filename*=UTF-8''{safe_name}"
    )

    download_url = f"https://{account_name}.blob.core.windows.net/{container_name}/{blob_name}?{sas_token}"

    return {
        "downloadUrl": download_url,
        "originalName": entity.get("originalName"),
        "expiresInMinutes": 30
    }


@router.delete("/courses/{course_id}/materials/{file_id}")
def delete_material(
    course_id: str,
    file_id: str,
    current_user=Depends(get_current_user)
) -> dict[str, Any]:
    # Oprávnění: jen učitel nebo admin
    membership = require_course_membership(course_id, current_user["user_id"])
    if membership.get("role_in_course") not in ["teacher", "assistant"] and current_user.get("global_role") != "admin":
        raise HTTPException(status_code=403, detail="Pouze učitel může mazat materiály.")

    table = get_materials_table()
    try:
        entity = table.get_entity(partition_key=course_id, row_key=file_id)
    except ResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Soubor nebyl nalezen.")

    blob_name = entity.get("blobName")

    # Smazání z Blob Storage
    blob_service = get_blob_service()
    container_name = get_blob_container_name()
    blob_client = blob_service.get_blob_client(container=container_name, blob=blob_name)
    try:
        blob_client.delete_blob()
    except Exception:
        pass  # Blob už neexistuje, nevadí

    # Smazání metadat z Table Storage
    table.delete_entity(partition_key=course_id, row_key=file_id)

    return {"message": f"Soubor {file_id} byl smazán."}
