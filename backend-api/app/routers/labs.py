import json
import uuid
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, Form, UploadFile, File
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from azure.core.exceptions import ResourceNotFoundError
from azure.data.tables import UpdateMode
from datetime import datetime, timezone, timedelta
import re
import os
from azure.identity import DefaultAzureCredential
from azure.mgmt.containerinstance import ContainerInstanceManagementClient
from azure.mgmt.containerinstance.models import (
    ContainerGroup, Container, ResourceRequests, ResourceRequirements,
    Port, IpAddress, ContainerGroupNetworkProtocol, ImageRegistryCredential,
    EnvironmentVariable,
)
from azure.storage.blob import BlobServiceClient, generate_blob_sas, BlobSasPermissions
from app.storage import get_lab_sessions_table

from app.auth import get_current_user, require_course_membership, get_course_membership
from app.storage import (
    get_labtemplates_table,
    get_scenarios_table,
    get_course_scenarios_table,
    get_attempts_table,
    get_lab_queue,
    build_artifact_path,
    get_file_share_name,
    utc_now_iso,
)
from app.models.schemas import (
    LabTemplateCreateRequest,
    ScenarioTemplateCreateRequest,
    CourseScenarioCreateRequest,
    ScenarioStartRequest,
)

def _generate_init_sas_url(blob_prefix: str) -> str | None:
    conn = os.getenv("BLOB_CONNECTION_STRING")
    if not conn:
        return None
    parts = dict(p.split("=", 1) for p in conn.split(";") if "=" in p)
    account_name = parts.get("AccountName", "")
    account_key = parts.get("AccountKey", "")
    if not account_name or not account_key:
        return None
    blob_name = f"{blob_prefix}init.sh".lstrip("/")
    expiry = datetime.now(timezone.utc) + timedelta(hours=4)
    sas_token = generate_blob_sas(
        account_name=account_name,
        container_name="lab-init-files",
        blob_name=blob_name,
        account_key=account_key,
        permission=BlobSasPermissions(read=True),
        expiry=expiry,
    )
    return f"https://{account_name}.blob.core.windows.net/lab-init-files/{blob_name}?{sas_token}"


def _provision_kali_aci(attempt_id: str, student_id: str, lab_image: str = "adaptivekoza01.azurecr.io/adaptive-lab-kali:v3", extra_env_vars: list | None = None):
    sub_id = os.getenv("AZURE_SUBSCRIPTION_ID")
    rg_name = os.getenv("AZURE_RESOURCE_GROUP")
    location = os.getenv("AZURE_LOCATION", "swedencentral")
    acr_password = os.getenv("ACR_PASSWORD")
    
    credential = DefaultAzureCredential()
    client = ContainerInstanceManagementClient(credential, sub_id)

    # Musí být unikátní v celém Azure regionu
    dns_label = f"lab-kali-{attempt_id.lower()}" 
    container_name = f"aci-kali-{attempt_id.lower()}"

    resources = ResourceRequirements(requests=ResourceRequests(memory_in_gb=4.0, cpu=2.0))

    env_vars = [EnvironmentVariable(name=e["name"], value=e["value"]) for e in (extra_env_vars or [])]

    container = Container(
        name=container_name,
        image=lab_image,
        resources=resources,
        ports=[Port(port=6080)],
        environment_variables=env_vars or None,
    )

    image_registry_credentials = [
        ImageRegistryCredential(
            server="adaptivekoza01.azurecr.io",
            username="adaptivekoza01",
            password=acr_password
        )
    ]

    group = ContainerGroup(
        location=location,
        containers=[container],
        os_type="Linux",
        ip_address=IpAddress(
            # Tady byla drobná nejasnost v protokolu, raději ho definujeme explicitně
            ports=[Port(protocol="TCP", port=6080)], 
            type="Public",
            dns_name_label=dns_label
        ),
        image_registry_credentials=image_registry_credentials,
        restart_policy="Never"
    )

    try:
        poller = client.container_groups.begin_create_or_update(rg_name, container_name, group)
        result = poller.result()
        ip_address = result.ip_address.ip
        # 4. Vrátíme URL přímo s IP adresou (místo nespolehlivého DNS)
        return f"http://{ip_address}:6080/vnc.html?resize=remote&autoconnect=1"

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Azure API selhalo: {e}")

router = APIRouter(tags=["Labs and Scenarios"])

@router.post("/labtemplates")
def create_labtemplate(payload: LabTemplateCreateRequest, current_user=Depends(get_current_user)) -> JSONResponse:
    if current_user.get("global_role") not in ["teacher", "admin"]:
        raise HTTPException(status_code=403, detail="Lab template může vytvořit jen učitel nebo admin.")
    table = get_labtemplates_table()
    entity = {
        "PartitionKey": "LABTEMPLATE",
        "RowKey": payload.template_id,
        "template_id": payload.template_id,
        "title": payload.title,
        "labImage": payload.lab_image,
        "fileShareName": payload.file_share_name,
        "mountPath": payload.mount_path,
        "runtimeConfig": payload.runtime_config,
        "timeoutSeconds": payload.timeout_seconds,
        "cpu": payload.cpu,
        "memoryGb": payload.memory_gb,
        "createdBy": current_user["user_id"],
        "createdAt": utc_now_iso(),
        "status": payload.status,
    }
    try:
        table.create_entity(entity=entity)
    except Exception as exc:
        raise HTTPException(status_code=409, detail=f"Lab template už existuje nebo nejde vytvořit: {exc}")
    return JSONResponse(status_code=201, content={"message": "Lab template created.", "templateId": payload.template_id})

@router.get("/labtemplates")
def list_labtemplates(current_user=Depends(get_current_user)) -> list[dict[str, Any]]:
    table = get_labtemplates_table()
    result = []
    for entity in table.list_entities():
        result.append({
            "templateId": entity.get("template_id"),
            "title": entity.get("title"),
            "labImage": entity.get("labImage"),
            "fileShareName": entity.get("fileShareName", ""),
            "mountPath": entity.get("mountPath", ""),
            "runtimeConfig": entity.get("runtimeConfig", "{}"),
            "timeoutSeconds": entity.get("timeoutSeconds", 900),
            "cpu": entity.get("cpu", 1),
            "memoryGb": entity.get("memoryGb", 1),
            "createdBy": entity.get("createdBy", ""),
            "createdAt": entity.get("createdAt", ""),
            "status": entity.get("status", ""),
            "isCustom": bool(entity.get("isCustom", False)),
            "description": entity.get("description", ""),
            "initBlobPrefix": entity.get("initBlobPrefix", ""),
            "baseImage": entity.get("baseImage", ""),
        })
    result.sort(key=lambda x: x["templateId"] or "")
    return result

_BASE_IMAGE_MAP = {
    "kali": "adaptivekoza01.azurecr.io/adaptive-lab-kali:v3",
    "ubuntu": "ubuntu",
}

@router.post("/labtemplates/custom")
async def create_custom_labtemplate(
    title: str = Form(...),
    base_image: str = Form(...),
    init_script: str = Form(default=""),
    description: str = Form(default=""),
    timeout_seconds: int = Form(default=900),
    cpu: int = Form(default=1),
    memory_gb: int = Form(default=2),
    files: list[UploadFile] = File(default=[]),
    current_user=Depends(get_current_user),
) -> JSONResponse:
    if current_user.get("global_role") not in ["teacher", "admin"]:
        raise HTTPException(status_code=403, detail="Lab image může vytvořit jen učitel nebo admin.")

    lab_image = _BASE_IMAGE_MAP.get(base_image, "ubuntu")
    template_id = f"custom-{uuid.uuid4().hex[:10]}"
    blob_prefix = f"{template_id}/"
    has_init = bool(init_script.strip() or files)

    if has_init:
        conn = os.getenv("BLOB_CONNECTION_STRING")
        if not conn:
            raise HTTPException(status_code=500, detail="Chybí BLOB_CONNECTION_STRING.")
        blob_service = BlobServiceClient.from_connection_string(conn)
        container_client = blob_service.get_container_client("lab-init-files")
        try:
            container_client.create_container()
        except Exception:
            pass

        if init_script.strip():
            container_client.get_blob_client(f"{blob_prefix}init.sh").upload_blob(
                init_script.encode("utf-8"), overwrite=True
            )

        for f in files:
            content = await f.read()
            safe_name = f.filename.replace("/", "_").replace("\\", "_")
            container_client.get_blob_client(f"{blob_prefix}{safe_name}").upload_blob(content, overwrite=True)

    table = get_labtemplates_table()
    entity = {
        "PartitionKey": "LABTEMPLATE",
        "RowKey": template_id,
        "template_id": template_id,
        "title": title,
        "labImage": lab_image,
        "fileShareName": "labs",
        "mountPath": "/mnt/output",
        "runtimeConfig": "{}",
        "timeoutSeconds": timeout_seconds,
        "cpu": cpu,
        "memoryGb": memory_gb,
        "createdBy": current_user["user_id"],
        "createdAt": utc_now_iso(),
        "status": "active",
        "isCustom": True,
        "description": description,
        "initBlobPrefix": blob_prefix if has_init else "",
        "baseImage": base_image,
    }
    try:
        table.create_entity(entity=entity)
    except Exception as exc:
        raise HTTPException(status_code=409, detail=f"Lab image nejde vytvořit: {exc}")

    return JSONResponse(status_code=201, content={"message": "Custom lab image created.", "templateId": template_id})


@router.delete("/labtemplates/{template_id}")
def delete_labtemplate(template_id: str, current_user=Depends(get_current_user)) -> JSONResponse:
    if current_user.get("global_role") not in ["teacher", "admin"]:
        raise HTTPException(status_code=403, detail="Nedostatečná práva.")

    table = get_labtemplates_table()
    try:
        entity = table.get_entity(partition_key="LABTEMPLATE", row_key=template_id)
    except ResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Lab template nebyl nalezen.")

    if entity.get("isCustom") and entity.get("initBlobPrefix"):
        try:
            conn = os.getenv("BLOB_CONNECTION_STRING")
            if conn:
                blob_service = BlobServiceClient.from_connection_string(conn)
                container_client = blob_service.get_container_client("lab-init-files")
                for blob in container_client.list_blobs(name_starts_with=entity["initBlobPrefix"]):
                    container_client.delete_blob(blob.name)
        except Exception:
            pass

    table.delete_entity(partition_key="LABTEMPLATE", row_key=template_id)
    return JSONResponse(status_code=200, content={"message": "Lab template smazán."})


@router.get("/labtemplates/{template_id}/init-script")
def get_labtemplate_init_script(template_id: str, current_user=Depends(get_current_user)) -> JSONResponse:
    if current_user.get("global_role") not in ["teacher", "admin"]:
        raise HTTPException(status_code=403, detail="Nedostatečná práva.")

    table = get_labtemplates_table()
    try:
        entity = table.get_entity(partition_key="LABTEMPLATE", row_key=template_id)
    except ResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Lab template nebyl nalezen.")

    blob_prefix = entity.get("initBlobPrefix", "")
    if not blob_prefix:
        return JSONResponse(status_code=200, content={"init_script": ""})

    conn = os.getenv("BLOB_CONNECTION_STRING")
    if not conn:
        raise HTTPException(status_code=500, detail="Chybí BLOB_CONNECTION_STRING.")

    try:
        blob_service = BlobServiceClient.from_connection_string(conn)
        blob_client = blob_service.get_blob_client(
            container="lab-init-files", blob=f"{blob_prefix}init.sh"
        )
        content = blob_client.download_blob().readall().decode("utf-8")
        return JSONResponse(status_code=200, content={"init_script": content})
    except Exception:
        return JSONResponse(status_code=200, content={"init_script": ""})


class _InitScriptUpdateRequest(BaseModel):
    init_script: str


@router.put("/labtemplates/{template_id}/init-script")
def update_labtemplate_init_script(
    template_id: str,
    payload: _InitScriptUpdateRequest,
    current_user=Depends(get_current_user),
) -> JSONResponse:
    if current_user.get("global_role") not in ["teacher", "admin"]:
        raise HTTPException(status_code=403, detail="Nedostatečná práva.")

    table = get_labtemplates_table()
    try:
        entity = table.get_entity(partition_key="LABTEMPLATE", row_key=template_id)
    except ResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Lab template nebyl nalezen.")

    created_by = entity.get("createdBy", "")
    if current_user.get("global_role") != "admin" and current_user["user_id"] != created_by:
        raise HTTPException(status_code=403, detail="Init script může upravovat jen tvůrce lab image nebo admin.")

    blob_prefix = entity.get("initBlobPrefix", "")
    if not blob_prefix:
        blob_prefix = f"{template_id}/"
        entity["initBlobPrefix"] = blob_prefix
        table.update_entity(mode=UpdateMode.MERGE, entity=entity)

    conn = os.getenv("BLOB_CONNECTION_STRING")
    if not conn:
        raise HTTPException(status_code=500, detail="Chybí BLOB_CONNECTION_STRING.")

    blob_service = BlobServiceClient.from_connection_string(conn)
    container_client = blob_service.get_container_client("lab-init-files")
    try:
        container_client.create_container()
    except Exception:
        pass

    container_client.get_blob_client(f"{blob_prefix}init.sh").upload_blob(
        payload.init_script.encode("utf-8"), overwrite=True
    )
    return JSONResponse(status_code=200, content={"message": "Init script uložen."})


@router.get("/labtemplates/{template_id}/files")
def list_lab_template_files(template_id: str, current_user=Depends(get_current_user)) -> JSONResponse:
    table = get_labtemplates_table()
    try:
        entity = table.get_entity(partition_key="LABTEMPLATE", row_key=template_id)
    except ResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Lab template nenalezen.")
    if not entity.get("isCustom"):
        raise HTTPException(status_code=400, detail="Pouze custom lab templates podporují správu souborů.")

    blob_prefix = entity.get("initBlobPrefix", f"{template_id}/")

    conn = os.getenv("BLOB_CONNECTION_STRING")
    if not conn:
        raise HTTPException(status_code=500, detail="Chybí BLOB_CONNECTION_STRING.")

    blob_service = BlobServiceClient.from_connection_string(conn)
    container_client = blob_service.get_container_client("lab-init-files")

    files = []
    try:
        for blob in container_client.list_blobs(name_starts_with=blob_prefix):
            name = blob.name[len(blob_prefix):]
            if name == "init.sh" or not name:
                continue
            files.append({
                "name": name,
                "size": blob.size,
                "lastModified": blob.last_modified.isoformat() if blob.last_modified else None,
            })
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Chyba při listování souborů: {exc}")

    return JSONResponse(content={"files": files})


@router.delete("/labtemplates/{template_id}/files/{filename:path}")
def delete_lab_template_file(template_id: str, filename: str, current_user=Depends(get_current_user)) -> JSONResponse:
    table = get_labtemplates_table()
    try:
        entity = table.get_entity(partition_key="LABTEMPLATE", row_key=template_id)
    except ResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Lab template nenalezen.")
    if not entity.get("isCustom"):
        raise HTTPException(status_code=400, detail="Pouze custom lab templates podporují správu souborů.")

    user_id = current_user["user_id"]
    created_by = entity.get("createdBy", "")
    is_admin = current_user.get("global_role") == "admin"
    if not is_admin and user_id != created_by:
        raise HTTPException(status_code=403, detail="Pouze autor nebo admin může mazat soubory.")

    if filename == "init.sh":
        raise HTTPException(status_code=400, detail="init.sh nelze smazat tímto endpointem.")

    blob_prefix = entity.get("initBlobPrefix", f"{template_id}/")

    conn = os.getenv("BLOB_CONNECTION_STRING")
    if not conn:
        raise HTTPException(status_code=500, detail="Chybí BLOB_CONNECTION_STRING.")

    blob_service = BlobServiceClient.from_connection_string(conn)
    container_client = blob_service.get_container_client("lab-init-files")
    try:
        container_client.get_blob_client(f"{blob_prefix}{filename}").delete_blob()
    except ResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Soubor nenalezen.")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Chyba při mazání souboru: {exc}")

    return JSONResponse(content={"message": f"Soubor '{filename}' byl smazán."})


@router.post("/labtemplates/{template_id}/files")
async def upload_lab_template_file(
    template_id: str,
    files: list[UploadFile] = File(...),
    current_user=Depends(get_current_user),
) -> JSONResponse:
    table = get_labtemplates_table()
    try:
        entity = table.get_entity(partition_key="LABTEMPLATE", row_key=template_id)
    except ResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Lab template nenalezen.")
    if not entity.get("isCustom"):
        raise HTTPException(status_code=400, detail="Pouze custom lab templates podporují správu souborů.")

    user_id = current_user["user_id"]
    created_by = entity.get("createdBy", "")
    is_admin = current_user.get("global_role") == "admin"
    if not is_admin and user_id != created_by:
        raise HTTPException(status_code=403, detail="Pouze autor nebo admin může nahrávat soubory.")

    blob_prefix = entity.get("initBlobPrefix", f"{template_id}/")

    conn = os.getenv("BLOB_CONNECTION_STRING")
    if not conn:
        raise HTTPException(status_code=500, detail="Chybí BLOB_CONNECTION_STRING.")

    blob_service = BlobServiceClient.from_connection_string(conn)
    container_client = blob_service.get_container_client("lab-init-files")
    try:
        container_client.create_container()
    except Exception:
        pass

    uploaded = []
    for f in files:
        if f.filename == "init.sh":
            continue
        data = await f.read()
        container_client.get_blob_client(f"{blob_prefix}{f.filename}").upload_blob(data, overwrite=True)
        uploaded.append(f.filename)

    return JSONResponse(content={"uploaded": uploaded})


@router.post("/scenario-templates")
def create_scenario_template(payload: ScenarioTemplateCreateRequest, current_user=Depends(get_current_user)) -> JSONResponse:
    if current_user.get("global_role") not in ["teacher", "admin"]:
        raise HTTPException(status_code=403, detail="Scénář může vytvořit jen učitel nebo admin.")

    templates = get_labtemplates_table()
    try:
        templates.get_entity(partition_key="LABTEMPLATE", row_key=payload.linked_template_id)
    except ResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Navázaná technická šablona nebyla nalezena.")

    scenarios = get_scenarios_table()
    entity = {
        "PartitionKey": "SCENARIO_TEMPLATE",
        "RowKey": payload.scenario_template_id,
        "scenario_template_id": payload.scenario_template_id,
        "linked_template_id": payload.linked_template_id,
        "title": payload.title,
        "description": payload.description,
        "instructions": payload.instructions,
        "hints": payload.hints,
        "difficulty": payload.difficulty,
        "expectedOutputs": payload.expected_outputs,
        "gradingRubric": payload.grading_rubric,
        "requiredOs": payload.required_os,
        "createdBy": current_user["user_id"],
        "createdAt": utc_now_iso(),
        "status": payload.status,
        "taskConfigJson": payload.task_config_json,
    }

    try:
        scenarios.create_entity(entity=entity)
    except Exception as exc:
        raise HTTPException(status_code=409, detail=f"Šablona scénáře už existuje nebo nejde vytvořit: {exc}")

    return JSONResponse(status_code=201, content={
        "message": "Scenario template created.",
        "scenarioTemplateId": payload.scenario_template_id
    })

@router.post("/course-scenarios")
def create_course_scenario(payload: CourseScenarioCreateRequest, current_user=Depends(get_current_user)) -> JSONResponse:
    membership = get_course_membership(payload.course_id, current_user["user_id"])

    if current_user.get("global_role") != "admin":
        if not membership or membership.get("role_in_course") not in ["teacher", "assistant"]:
            raise HTTPException(status_code=403, detail="Scénář může do kurzu přiřadit jen správce nebo asistent tohoto kurzu.")

    scenarios = get_scenarios_table()

    scenarios = get_scenarios_table()
    try:
        scenarios.get_entity(partition_key="SCENARIO_TEMPLATE", row_key=payload.scenario_template_id)
    except ResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Šablona scénáře nebyla nalezena.")

    course_scenarios = get_course_scenarios_table()
    entity = {
        "PartitionKey": payload.course_id,
        "RowKey": payload.course_scenario_id,
        "courseScenarioId": payload.course_scenario_id,
        "courseId": payload.course_id,
        "scenarioTemplateId": payload.scenario_template_id,
        "deadline": payload.deadline,
        "maxAttempts": payload.max_attempts,
        "assigned_to_groups": payload.assigned_to_groups,
        "status": payload.status,
        "assignedBy": current_user["user_id"],
        "assignedAt": utc_now_iso(),
    }

    try:
        course_scenarios.create_entity(entity=entity)
    except Exception as exc:
        raise HTTPException(status_code=409, detail=f"Přiřazení scénáře do kurzu už existuje nebo nejde vytvořit: {exc}")

    return JSONResponse(status_code=201, content={
        "message": "Course scenario created.",
        "courseScenarioId": payload.course_scenario_id
    })

@router.get("/scenarios/{scenario_id}")
def get_scenario(scenario_id: str, current_user=Depends(get_current_user)) -> dict[str, Any]:
    table = get_scenarios_table()
    try:
        entity = table.get_entity(partition_key="SCENARIO", row_key=scenario_id)
    except ResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Scénář nebyl nalezen.")
    course_id = entity.get("course_id", "")
    require_course_membership(course_id, current_user["user_id"])
    return {
        "scenarioId": entity.get("scenario_id"),
        "courseId": entity.get("course_id"),
        "linkedTemplateId": entity.get("linked_template_id"),
        "title": entity.get("title"),
        "description": entity.get("description", ""),
        "instructions": entity.get("instructions", ""),
        "hints": entity.get("hints", ""),
        "difficulty": entity.get("difficulty", ""),
        "expectedOutputs": entity.get("expectedOutputs", ""),
        "gradingRubric": entity.get("gradingRubric", ""),
        "createdBy": entity.get("createdBy", ""),
        "createdAt": entity.get("createdAt", ""),
        "status": entity.get("status"),
        "deadline": entity.get("deadline", ""),
        "maxAttempts": entity.get("maxAttempts", 0),
    }

@router.post("/scenarios/{scenario_id}/start")
def start_scenario(scenario_id: str, payload: ScenarioStartRequest, current_user=Depends(get_current_user)) -> JSONResponse:
    scenario_templates = get_scenarios_table()
    course_scenarios = get_course_scenarios_table()
    labtemplates = get_labtemplates_table()
    attempts = get_attempts_table()

    course_scenario = None
    for entity in course_scenarios.list_entities():
        if entity.get("courseScenarioId") == scenario_id:
            course_scenario = entity
            break

    if not course_scenario:
        raise HTTPException(status_code=404, detail="Course scenario nebyl nalezen.")

    course_id = course_scenario.get("courseId")
    scenario_template_id = course_scenario.get("scenarioTemplateId")
    deadline_str = course_scenario.get("deadline", "")
    max_attempts = int(course_scenario.get("maxAttempts", 0) or 0)

    membership = require_course_membership(course_id, current_user["user_id"])
    if current_user.get("global_role") == "student" and membership.get("role_in_course") != "student":
        raise HTTPException(status_code=403, detail="Student nemá v kurzu studentskou roli.")

    if deadline_str:
        try:
            deadline_dt = datetime.fromisoformat(deadline_str).astimezone(timezone.utc)
            now_dt = datetime.now(timezone.utc)
            if now_dt > deadline_dt:
                raise HTTPException(status_code=403, detail="Termín pro spuštění této úlohy již vypršel.")
        except ValueError:
            pass

    user_attempts_count = 0
    for a in attempts.list_entities():
        if a.get("scenarioId") == scenario_id and a.get("userId") == current_user["user_id"]:
            user_attempts_count += 1

    if max_attempts > 0 and user_attempts_count >= max_attempts:
        raise HTTPException(
            status_code=403,
            detail=f"Vyčerpali jste maximální povolený počet pokusů ({max_attempts})."
        )

    try:
        scenario_template = scenario_templates.get_entity(
            partition_key="SCENARIO_TEMPLATE",
            row_key=scenario_template_id
        )
    except ResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Scenario template nebyl nalezen.")

    template_id = scenario_template.get("linked_template_id")
    required_os = scenario_template.get("requiredOs", "ubuntu")

    if not template_id:
        raise HTTPException(status_code=500, detail="Scenario template nemá linked_template_id.")

    try:
        template = labtemplates.get_entity(partition_key="LABTEMPLATE", row_key=template_id)
    except ResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Navázaná technická šablona nebyla nalezena.")

    attempt_id = payload.attempt_id or f"attempt-{uuid.uuid4().hex[:8]}"
    artifact_path = build_artifact_path(scenario_id, attempt_id)
    created_at = utc_now_iso()
    safe_scenario_id = re.sub(r"[^a-z0-9-]", "-", scenario_id.lower())
    safe_attempt_id = re.sub(r"[^a-z0-9-]", "-", attempt_id.lower())

    safe_scenario_id = re.sub(r"-+", "-", safe_scenario_id).strip("-")
    safe_attempt_id = re.sub(r"-+", "-", safe_attempt_id).strip("-")

    container_group_name = f"aci-{safe_scenario_id}-{safe_attempt_id}"[:63].strip("-")
    run_number = user_attempts_count + 1

    attempt_entity = {
        "PartitionKey": "attempts",
        "RowKey": attempt_id,
        "attemptId": attempt_id,
        "scenarioId": scenario_id,
        "scenarioTemplateId": scenario_template_id,
        "templateId": template_id,
        "requiredOs": required_os,
        "courseId": course_id,
        "userId": current_user["user_id"],
        "userRole": current_user.get("global_role"),
        "status": "queued",
        "learningStatus": "started",
        "artifactPath": artifact_path,
        "createdAt": created_at,
        "finishedAt": "",
        "detail": "Scenario attempt created by backend API and queued for processing.",
        "updatedAt": created_at,
        "runNumber": run_number,
        "submissionNote": "",
        "submittedAt": "",
        "submittedArtifactPath": "",
        "feedbackText": "",
        "feedbackAt": "",
    }
    attempts.upsert_entity(mode=UpdateMode.MERGE, entity=attempt_entity)

    queue_payload: dict[str, Any] = {
        "attempt_id": attempt_id,
        "scenario_id": scenario_id,
        "template_id": template_id,
        "required_os": required_os,
        "course_id": course_id,
        "user_id": current_user["user_id"],
        "user_role": current_user.get("global_role"),
        "lab_image": template["labImage"],
        "container_group_name": container_group_name,
        "file_share_name": template.get("fileShareName", get_file_share_name()),
        "mount_path": template.get("mountPath", "/mnt/output"),
        "artifact_path": artifact_path,
    }
    gui_url = None
    effective_image = payload.lab_image if payload.lab_image else template.get("labImage", "")
    if payload.lab_image == "skip":
        # Testovací režim — attempt se vytvoří ale ACI se nespustí
        attempt_entity["status"] = "succeeded"
        attempt_entity["guiUrl"] = "skip"
        attempt_entity["labReadyAt"] = utc_now_iso()
        attempts.update_entity(mode=UpdateMode.REPLACE, entity=attempt_entity)
    elif "adaptive-lab-kali" in effective_image:
        extra_env_vars = []
        # Pokud byl přes lab-selector vybrán konkrétní custom template, načti init prefix z něj
        if payload.override_template_id:
            try:
                override_tmpl = labtemplates.get_entity(partition_key="LABTEMPLATE", row_key=payload.override_template_id)
                init_blob_prefix = override_tmpl.get("initBlobPrefix", "")
            except Exception:
                init_blob_prefix = template.get("initBlobPrefix", "")
        else:
            init_blob_prefix = template.get("initBlobPrefix", "")
        if init_blob_prefix:
            sas_url = _generate_init_sas_url(init_blob_prefix)
            if sas_url:
                extra_env_vars.append({"name": "LAB_INIT_BLOB_URL", "value": sas_url})
        gui_url = _provision_kali_aci(attempt_id, current_user["user_id"], effective_image, extra_env_vars or None)
        attempt_entity["status"] = "succeeded"
        attempt_entity["guiUrl"] = gui_url
        attempt_entity["labReadyAt"] = utc_now_iso()
        attempts.update_entity(mode=UpdateMode.REPLACE, entity=attempt_entity)
        sessions = get_lab_sessions_table()
        sessions.create_entity(entity={
            "PartitionKey": current_user["user_id"],
            "RowKey": attempt_id,
            "guiUrl": gui_url,
            "status": "succeeded",
            "createdAt": created_at
        })
    else:
        # Původní logika pro textové (staré) laby:
        queue_client = get_lab_queue()
        queue_client.send_message(json.dumps(queue_payload))

    return JSONResponse(status_code=202, content={
        "message": "Scenario started.",
        "guiUrl": gui_url if gui_url else ("skip" if payload.lab_image == "skip" else None),
        "scenarioId": scenario_id,
        "scenarioTemplateId": scenario_template_id,
        "templateId": template_id,
        "requiredOs": required_os,
        "courseId": course_id,
        "attemptId": attempt_id,
        "userId": current_user["user_id"],
        "status": "succeeded" if (gui_url or payload.lab_image == "skip") else "queued",
        "learningStatus": "started",
        "artifactPath": artifact_path,
        "runNumber": run_number,
        "maxAttempts": max_attempts,
    })

def _delete_kali_aci(attempt_id: str):
    sub_id = os.getenv("AZURE_SUBSCRIPTION_ID")
    rg_name = os.getenv("AZURE_RESOURCE_GROUP")
    credential = DefaultAzureCredential()
    client = ContainerInstanceManagementClient(credential, sub_id)
    container_name = f"aci-kali-{attempt_id}"
    try:
        client.container_groups.begin_delete(rg_name, container_name)
    except Exception:
        pass

@router.post("/attempts/{attempt_id}/stop")
def stop_attempt(attempt_id: str, current_user=Depends(get_current_user)) -> JSONResponse:
    attempts_table = get_attempts_table()
    sessions_table = get_lab_sessions_table()
    
    try:
        attempt = attempts_table.get_entity(partition_key="attempts", row_key=attempt_id)
    except ResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Pokus nebyl nalezen.")

    try:
        session = sessions_table.get_entity(partition_key=attempt.get("userId"), row_key=attempt_id)
        if session.get("status") != "deleted":
            _delete_kali_aci(attempt_id)
            session["status"] = "deleted"
            sessions_table.update_entity(mode=UpdateMode.REPLACE, entity=session)
    except ResourceNotFoundError:
        pass

    attempt["status"] = "finished"
    attempt["learningStatus"] = "completed"
    attempt["finishedAt"] = utc_now_iso()
    attempts_table.update_entity(mode=UpdateMode.REPLACE, entity=attempt)

    return JSONResponse(status_code=200, content={"message": "Lab ukončen.", "status": "finished"})

