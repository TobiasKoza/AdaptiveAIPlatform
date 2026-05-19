from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from typing import Any, Optional
from pydantic import BaseModel
from azure.core.exceptions import ResourceNotFoundError
from azure.data.tables import UpdateMode
import re
import random
from fastapi import UploadFile, File
from fastapi.responses import Response
import uuid
from app.routers.materials import get_blob_service, get_blob_container_name
from app.auth import get_current_user, require_course_membership, get_course_membership

from app.storage import (
    get_courses_table,
    get_coursemembers_table,
    get_assignments_table,
    get_scenarios_table,
    get_course_scenarios_table,
    get_users_table,
    get_attempts_table,
    get_groupmembers_table,
    get_groups_table,
    get_labtemplates_table,
    utc_now_iso,
)
from app.models.schemas import CourseCreateRequest, CourseMemberCreateRequest

router = APIRouter(prefix="/courses", tags=["Courses"])

class CourseUpdate(BaseModel):
    title: Optional[str] = None
    status: Optional[str] = None
    description: Optional[str] = None

class CourseScenarioUpdate(BaseModel):
    status: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    instructions: Optional[str] = None
    hints: Optional[str] = None
    deadline: Optional[str] = None
    maxAttempts: Optional[int] = None
    additionalManagers: Optional[str] = None
    expectedOutputs: Optional[str] = None
    gradingRubric: Optional[str] = None
    assigned_to_groups: Optional[str] = None
    taskConfigJson: Optional[str] = None
    requiredOs: Optional[str] = None


def get_course_or_404(course_id: str) -> dict[str, Any]:
    """
    Načte kurz podle COURSE / course_id.
    Pokud neexistuje, vrátí 404.
    """
    courses_table = get_courses_table()
    try:
        return courses_table.get_entity(partition_key="COURSE", row_key=course_id)
    except ResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Kurz nenalezen.")


def ensure_course_visible_for_student(course_id: str, current_user: dict[str, Any]) -> dict[str, Any]:
    """
    Zajistí, že student nemůže pracovat s inactive kurzem nebo pokud má vypnuté členství.
    """
    course = get_course_or_404(course_id)

    if current_user.get("global_role") == "student":
        if course.get("status") == "inactive":
            raise HTTPException(status_code=403, detail="Kurz je neaktivní.")
        membership = get_course_membership(course_id, current_user["user_id"])
        if membership and membership.get("status") == "inactive":
            raise HTTPException(status_code=403, detail="Váš přístup k tomuto kurzu byl pozastaven.")

    return course


def build_assigned_student_count_map() -> dict[str, int]:
    """
    Spočítá skutečný počet zapsaných studentů v každém kurzu
    podle coursemembers_table + users_table.

    Vrací mapu:
        {
            "kyb101": 4,
            "kyb102": 1,
        }
    """
    users_table = get_users_table()
    coursemembers = get_coursemembers_table()

    student_user_ids = {
        user.get("RowKey")
        for user in users_table.list_entities()
        if user.get("PartitionKey") == "USER" and user.get("global_role") == "student"
    }

    counts: dict[str, int] = {}

    for member in coursemembers.list_entities():
        course_id = member.get("PartitionKey")
        user_id = member.get("RowKey")

        if not course_id:
            continue
        if user_id not in student_user_ids:
            continue
        
        if member.get("status") == "inactive":
            continue

        counts[course_id] = counts.get(course_id, 0) + 1

    return counts

@router.get("")
def list_my_courses(current_user=Depends(get_current_user)) -> list[dict[str, Any]]:
    courses_table = get_courses_table()
    coursemembers = get_coursemembers_table()
    role = current_user.get("global_role")
    result = []

    assigned_student_counts = build_assigned_student_count_map()

    if role in ["teacher", "admin"]:
        for course in courses_table.list_entities():
            if course.get("PartitionKey") != "COURSE":
                continue

            course_id = course.get("course_id") or course.get("RowKey")
            status = course.get("status", "")
            assigned_student_count = assigned_student_counts.get(course_id, 0)
            visible_student_count = 0 if status == "inactive" else assigned_student_count

            result.append({
                "courseId": course_id,
                "title": course.get("title"),
                "description": course.get("description", ""),
                "status": status,
                "roleInCourse": role,
                "studentCount": visible_student_count,
                "assignedStudentCount": assigned_student_count,
                "ownerUserId": course.get("owner_user_id", ""),
            })

        result.sort(key=lambda x: x["courseId"] or "")
        return result

    for member in coursemembers.list_entities():
        if member.get("RowKey") != current_user.get("user_id"):
            continue

        course_id = member.get("PartitionKey")

        try:
            course = courses_table.get_entity(partition_key="COURSE", row_key=course_id)
        except ResourceNotFoundError:
            continue

        if course.get("status") == "inactive":
            continue
        if member.get("status") == "inactive":
            continue

        result.append({
            "courseId": course.get("course_id") or course.get("RowKey"),
            "title": course.get("title"),
            "description": course.get("description", ""),
            "status": course.get("status", ""),
            "roleInCourse": member.get("role_in_course"),
            "studentCount": assigned_student_counts.get(course_id, 0),
            "assignedStudentCount": assigned_student_counts.get(course_id, 0),
            "ownerUserId": course.get("owner_user_id", ""),
        })

    result.sort(key=lambda x: x["courseId"] or "")
    return result

@router.post("")
def create_course(payload: CourseCreateRequest, current_user=Depends(get_current_user)) -> JSONResponse:
    if current_user.get("global_role") not in ["teacher", "admin"]:
        raise HTTPException(status_code=403, detail="Kurz může vytvořit jen učitel nebo admin.")
    courses_table = get_courses_table()
    coursemembers = get_coursemembers_table()
    entity = {
        "PartitionKey": "COURSE",
        "RowKey": payload.course_id,
        "course_id": payload.course_id,
        "title": payload.title,
        "description": payload.description,
        "owner_user_id": current_user["user_id"],
        "status": payload.status,
        "created_at": utc_now_iso(),
    }
    try:
        courses_table.create_entity(entity=entity)
    except Exception as exc:
        raise HTTPException(status_code=409, detail=f"Kurz už existuje nebo nejde vytvořit: {exc}")
    
    membership = {
        "PartitionKey": payload.course_id,
        "RowKey": current_user["user_id"],
        "course_id": payload.course_id,
        "user_id": current_user["user_id"],
        "role_in_course": "teacher",
        "joined_at": utc_now_iso(),
    }
    coursemembers.upsert_entity(membership)
    return JSONResponse(status_code=201, content={"message": "Course created.", "courseId": payload.course_id})

@router.get("/{course_id}/members")
def list_course_members(course_id: str, current_user=Depends(get_current_user)):
    if current_user.get("global_role") not in ["teacher", "admin"]:
        raise HTTPException(status_code=403, detail="Nedostatečná práva.")
    table = get_coursemembers_table()
    entities = table.query_entities(query_filter=f"PartitionKey eq '{course_id}'")
    result = []
    for e in entities:
        result.append({
            "userId": e.get("RowKey"),
            "role": e.get("role_in_course") or "student",
            "status": e.get("status", "active")
        })
    return result

@router.post("/{course_id}/members")
def add_course_member(course_id: str, payload: CourseMemberCreateRequest, current_user=Depends(get_current_user)) -> JSONResponse:
    courses_table = get_courses_table()
    users_table = get_users_table()
    coursemembers = get_coursemembers_table()

    try:
        courses_table.get_entity(partition_key="COURSE", row_key=course_id)
    except ResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Kurz nebyl nalezen.")

    if current_user.get("global_role") != "admin":
        membership = get_course_membership(course_id, current_user["user_id"])
        if not membership or membership.get("role_in_course") != "teacher":
            raise HTTPException(status_code=403, detail="Jen správce tohoto kurzu může přidávat další členy.")

    try:
        users_table.get_entity(partition_key="USER", row_key=payload.user_id)
    except ResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Uživatel nebyl nalezen.")

    new_status = getattr(payload, 'status', 'active') if hasattr(payload, 'status') else 'active'

    entity = {
        "PartitionKey": course_id,
        "RowKey": payload.user_id,
        "course_id": course_id,
        "user_id": payload.user_id,
        "role_in_course": payload.role_in_course or "student",
        "status": new_status,
        "joined_at": utc_now_iso(),
    }
    coursemembers.upsert_entity(entity)
    return JSONResponse(status_code=201, content={"message": "Course member added.", "courseId": course_id, "userId": payload.user_id, "roleInCourse": payload.role_in_course})

@router.get("/{course_id}/assignments")
def list_course_assignments(course_id: str, current_user=Depends(get_current_user)) -> list[dict[str, Any]]:
    require_course_membership(course_id, current_user["user_id"])
    ensure_course_visible_for_student(course_id, current_user)
    table = get_assignments_table()
    result = []

    for entity in table.list_entities():
        if entity.get("course_id") != course_id:
            continue
        if current_user.get("global_role") == "student" and entity.get("status") not in ["published", "active"]:
            continue        
        result.append({
            "assignmentId": entity.get("assignmentId"),
            "title": entity.get("title"),
            "description": entity.get("description", ""),
            "labImage": entity.get("labImage"),
            "fileShareName": entity.get("fileShareName", ""),
            "mountPath": entity.get("mountPath", ""),
            "courseId": entity.get("course_id", ""),
            "createdBy": entity.get("created_by", ""),
            "status": entity.get("status", ""),
            "assignmentType": entity.get("assignment_type", ""),
            "createdAt": entity.get("createdAt", ""),
        })

    result.sort(key=lambda x: x["assignmentId"] or "")
    return result

@router.get("/{course_id}/scenarios")
def list_course_scenarios(course_id: str, current_user=Depends(get_current_user)) -> list[dict[str, Any]]:
    require_course_membership(course_id, current_user["user_id"])
    ensure_course_visible_for_student(course_id, current_user)

    scenario_templates_table = get_scenarios_table()
    course_scenarios_table = get_course_scenarios_table()
    
    student_groups = []
    is_student = current_user.get("global_role") == "student"
    if is_student:
        gm_table = get_groupmembers_table()
        try:
            user_groups = gm_table.query_entities(query_filter=f"RowKey eq '{current_user['user_id']}'")
            student_groups = [gm["PartitionKey"] for gm in user_groups]
        except:
            student_groups = []

    result = []

    for course_entity in course_scenarios_table.list_entities():
        if course_entity.get("courseId") != course_id:
            continue

        if is_student and course_entity.get("status") == "inactive":
            continue

        # Filtrace podle assigned_to_groups — WHITELIST
        # Prázdné pole = všichni studenti vidí zadání
        # "HIDDEN_FROM_ALL" = nikdo nevidí
        # Neprázdné pole = jen studenti v uvedených skupinách vidí zadání
        assigned_groups_str = course_entity.get("assigned_to_groups")
        if is_student and assigned_groups_str:
            if assigned_groups_str == "HIDDEN_FROM_ALL":
                continue
            allowed_groups = [g.strip() for g in assigned_groups_str.split(",") if g.strip()]
            if allowed_groups and not any(g in allowed_groups for g in student_groups):
                continue

        scenario_template_id = course_entity.get("scenarioTemplateId")
        if not scenario_template_id:
            continue

        try:
            template = scenario_templates_table.get_entity(
                partition_key="SCENARIO_TEMPLATE",
                row_key=scenario_template_id
            )
        except ResourceNotFoundError:
            continue

        result.append({
            "scenarioId": course_entity.get("courseScenarioId"),
            "courseId": course_entity.get("courseId"),
            "scenarioTemplateId": scenario_template_id,
            "linkedTemplateId": template.get("linked_template_id"),
            "title": template.get("title"),
            "description": template.get("description", ""),
            "instructions": template.get("instructions", ""),
            "hints": template.get("hints", ""),
            "difficulty": template.get("difficulty", ""),
            "expectedOutputs": template.get("expectedOutputs", ""),
            "gradingRubric": template.get("gradingRubric", ""),
            "requiredOs": template.get("requiredOs", "ubuntu"),
            "createdBy": template.get("createdBy", ""),
            "assignedBy": course_entity.get("assignedBy", ""),
            "createdAt": template.get("createdAt", ""),
            "status": course_entity.get("status", "active"),
            "deadline": course_entity.get("deadline", ""),
            "maxAttempts": course_entity.get("maxAttempts", 0),
            "additionalManagers": course_entity.get("additionalManagers", ""),
            "assigned_to_groups": assigned_groups_str,
            "taskConfigJson": template.get("taskConfigJson", ""),
            "prereqs": [p.strip() for p in (lambda m: m.group(1).split(",") if m else [])(
                __import__("re").search(r'\[PREREQS:([^\]]+)\]', template.get("hints", ""))
            )],
        })

    result.sort(key=lambda x: x["title"] or "")
    return result

@router.get("/{course_id}/groups")
def list_course_groups(course_id: str, current_user=Depends(get_current_user)) -> list[dict]:
    """Vrátí skupiny, které mají alespoň jednoho studenta v daném kurzu."""
    require_course_membership(course_id, current_user["user_id"])
    users_table = get_users_table()
    groups_table = get_groups_table()

    course_group_ids: set[str] = set()
    for u in users_table.list_entities():
        if u.get("global_role") != "student":
            continue
        course_ids = u.get("course_ids") or ""
        ids = course_ids if isinstance(course_ids, list) else str(course_ids).split(",")
        if course_id not in [x.strip() for x in ids]:
            continue
        group_ids = u.get("group_ids") or ""
        gids = group_ids if isinstance(group_ids, list) else str(group_ids).split(",")
        for gid in gids:
            g = gid.strip()
            if g:
                course_group_ids.add(g)

    result = []
    for e in groups_table.list_entities():
        gid = e.get("RowKey") or e.get("group_id") or ""
        if gid in course_group_ids:
            result.append({
                "groupId": gid,
                "title": e.get("title") or e.get("groupName") or e.get("name") or gid,
            })
    result.sort(key=lambda x: x["title"])
    return result

@router.get("/{course_id}/my-attempts")
def list_my_course_attempts(course_id: str, current_user=Depends(get_current_user)) -> list[dict[str, Any]]:
    require_course_membership(course_id, current_user["user_id"])
    ensure_course_visible_for_student(course_id, current_user)
    attempts_table = get_attempts_table()
    result = []

    for entity in attempts_table.list_entities():
        if entity.get("courseId") != course_id:
            continue
        if entity.get("userId") != current_user["user_id"]:
            continue

        _entry: dict = {
            "attemptId": entity.get("attemptId"),
            "scenarioId": entity.get("scenarioId", ""),
            "guiUrl": entity.get("guiUrl", ""),
            "status": entity.get("status", ""),
            "learningStatus": entity.get("learningStatus", ""),
            "artifactPath": entity.get("artifactPath", ""),
            "createdAt": entity.get("createdAt", ""),
            "finishedAt": entity.get("finishedAt", ""),
            "submittedAt": entity.get("submittedAt", ""),
            "submissionNote": entity.get("submissionNote", ""),
            "feedbackText": entity.get("feedbackText", ""),
            "feedbackAt": entity.get("feedbackAt", ""),
            "score": entity.get("score", None),
            "runNumber": entity.get("runNumber", 1),
        }
        _pai = entity.get("pausedAiState", "") or ""
        if _pai:
            _entry["pausedAiState"] = _pai
        result.append(_entry)

    result.sort(key=lambda x: x["createdAt"] or "", reverse=True)
    return result

@router.get("/{course_id}/attempts")
def list_course_attempts(course_id: str, current_user=Depends(get_current_user)) -> list[dict[str, Any]]:
    """
    Vrátí všechny pokusy (attempts) v rámci daného kurzu.
    Přístup má pouze učitel, asistent nebo admin.
    """
    is_admin = current_user.get("global_role") == "admin"
    membership = get_course_membership(course_id, current_user["user_id"])
    
    if not is_admin and (not membership or membership.get("role_in_course") not in ["teacher", "assistant"]):
        raise HTTPException(status_code=403, detail="Pouze učitel nebo admin může vidět pokusy v kurzu.")

    attempts_table = get_attempts_table()
    result = []

    for entity in attempts_table.list_entities():
        if entity.get("courseId") != course_id:
            continue

        result.append({
            "attemptId": entity.get("attemptId"),
            "scenarioId": entity.get("scenarioId", ""),
            "userId": entity.get("userId", ""),
            "guiUrl": entity.get("guiUrl", ""),
            "status": entity.get("status", ""),
            "learningStatus": entity.get("learningStatus", ""),
            "artifactPath": entity.get("artifactPath", ""),
            "createdAt": entity.get("createdAt", ""),
            "finishedAt": entity.get("finishedAt", ""),
            "submittedAt": entity.get("submittedAt", ""),
            "submissionNote": entity.get("submissionNote", ""),
            "feedbackText": entity.get("feedbackText", ""),
            "feedbackAt": entity.get("feedbackAt", ""),
            "score": entity.get("score", None),
            "runNumber": entity.get("runNumber", 1),
            "stepDetails": entity.get("stepDetails", ""),
        })
    result.sort(key=lambda x: x["createdAt"] or "", reverse=True)
    return result

@router.delete("/{course_id}/members/{user_id}")
def remove_course_member(course_id: str, user_id: str, current_user=Depends(get_current_user)):
    courses_table = get_courses_table()
    try:
        course = courses_table.get_entity(partition_key="COURSE", row_key=course_id)
    except ResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Kurz nenalezen.")

    if user_id == course.get("owner_user_id") and current_user.get("global_role") != "admin":
        raise HTTPException(status_code=403, detail="Nelze odebrat zakladatele kurzu.")

    if current_user.get("global_role") != "admin":
        membership = get_course_membership(course_id, current_user["user_id"])
        if not membership or membership.get("role_in_course") != "teacher":
            raise HTTPException(status_code=403, detail="Jen správce kurzu může odebírat členy.")
    
    coursemembers = get_coursemembers_table()
    try:
        coursemembers.delete_entity(partition_key=course_id, row_key=user_id)
        return {"message": "Uživatel odebrán z kurzu."}
    except Exception:
        raise HTTPException(status_code=404, detail="Členství nebylo nalezeno.")
    
@router.put("/{course_id}")
def update_course(course_id: str, payload: CourseUpdate, current_user=Depends(get_current_user)):
    if current_user.get("global_role") != "admin":
        membership = get_course_membership(course_id, current_user["user_id"])
        if not membership or membership.get("role_in_course") != "teacher":
            raise HTTPException(status_code=403, detail="Kurz může upravovat jen jeho správce.")
            
    courses_table = get_courses_table()
    try:
        course = courses_table.get_entity(partition_key="COURSE", row_key=course_id)
        if payload.title is not None: course["title"] = payload.title
        if payload.status is not None: course["status"] = payload.status
        if payload.description is not None: course["description"] = payload.description
        courses_table.update_entity(mode=UpdateMode.REPLACE, entity=course)
        return {"message": "Aktualizováno."}
    except ResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Kurz nenalezen.")

@router.delete("/{course_id}")
def delete_course(course_id: str, current_user=Depends(get_current_user)):
    if current_user.get("global_role") != "admin":
        membership = get_course_membership(course_id, current_user["user_id"])
        if not membership or membership.get("role_in_course") != "teacher":
            raise HTTPException(status_code=403, detail="Kurz může smazat jen jeho správce.")

    try:
        import os
        from azure.storage.blob import BlobServiceClient
        from app.storage import ensure_table
        blob_conn = os.getenv("BLOB_CONNECTION_STRING")
        container_name = os.getenv("BLOB_CONTAINER_MATERIALS", "course-materials")
        if blob_conn:
            blob_service = BlobServiceClient.from_connection_string(blob_conn)
            container_client = blob_service.get_container_client(container_name)
            blobs = list(container_client.list_blobs(name_starts_with=f"{course_id}/"))
            for blob in blobs:
                container_client.delete_blob(blob.name)
        mat_table = ensure_table(os.getenv("MATERIALS_TABLE_NAME", "coursematerials"))
        for entity in mat_table.query_entities(query_filter=f"PartitionKey eq '{course_id}'"):
            mat_table.delete_entity(partition_key=course_id, row_key=entity["RowKey"])
    except Exception as e:
        pass  # Mazání materiálů není kritické — kurz smažeme i bez toho

    courses_table = get_courses_table()
    try:
        courses_table.delete_entity(partition_key="COURSE", row_key=course_id)
        return {"message": "Smazáno."}
    except ResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Nenalezeno.")
    
@router.put("/{course_id}/scenarios/{scenario_id}")
def update_course_scenario(course_id: str, scenario_id: str, payload: CourseScenarioUpdate, current_user=Depends(get_current_user)):
    cs_table = get_course_scenarios_table()
    try:
        cs_entity = cs_table.get_entity(partition_key=course_id, row_key=scenario_id)
    except ResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Přiřazení zadání nenalezeno.")

    is_admin = current_user.get("global_role") == "admin"
    membership = get_course_membership(course_id, current_user["user_id"])
    is_course_teacher = membership and membership.get("role_in_course") == "teacher"
    
    # Bezpečné hledání: rozsekáme string na pole a odstraníme mezery, aby "jan" != "jan.novak"
    managers_list = [m.strip() for m in cs_entity.get("additionalManagers", "").split(",") if m.strip()]
    is_additional_manager = current_user["user_id"] in managers_list

    if not (is_admin or is_course_teacher or is_additional_manager):
        raise HTTPException(status_code=403, detail="Zadání může upravovat jen správce kurzu nebo přiřazený učitel.")
    
    if payload.status is not None: cs_entity["status"] = payload.status
    if payload.deadline is not None: cs_entity["deadline"] = payload.deadline
    if payload.maxAttempts is not None: cs_entity["maxAttempts"] = payload.maxAttempts
    if payload.additionalManagers is not None: cs_entity["additionalManagers"] = payload.additionalManagers
    if payload.assigned_to_groups is not None: cs_entity["assigned_to_groups"] = payload.assigned_to_groups

    cs_table.update_entity(mode=UpdateMode.REPLACE, entity=cs_entity)

    if any(x is not None for x in [payload.title, payload.description, payload.instructions, payload.hints, payload.expectedOutputs, payload.gradingRubric, payload.taskConfigJson, payload.requiredOs]):
        template_id = cs_entity.get("scenarioTemplateId")
        if template_id:
            scenarios_table = get_scenarios_table()
            try:
                sc_entity = scenarios_table.get_entity(partition_key="SCENARIO_TEMPLATE", row_key=template_id)
                if payload.title is not None: sc_entity["title"] = payload.title
                if payload.description is not None: sc_entity["description"] = payload.description
                if payload.instructions is not None: sc_entity["instructions"] = payload.instructions
                if payload.hints is not None: sc_entity["hints"] = payload.hints
                if payload.expectedOutputs is not None: sc_entity["expectedOutputs"] = payload.expectedOutputs
                if payload.gradingRubric is not None: sc_entity["gradingRubric"] = payload.gradingRubric
                if payload.taskConfigJson is not None: sc_entity["taskConfigJson"] = payload.taskConfigJson
                if payload.requiredOs is not None: sc_entity["requiredOs"] = payload.requiredOs

                scenarios_table.update_entity(mode=UpdateMode.REPLACE, entity=sc_entity)
            except ResourceNotFoundError:
                pass

    return {"message": "Zadání aktualizováno."}

@router.delete("/{course_id}/scenarios/{scenario_id}")
def remove_scenario_from_course(course_id: str, scenario_id: str, current_user=Depends(get_current_user)):
    if current_user.get("global_role") != "admin":
        membership = get_course_membership(course_id, current_user["user_id"])
        if not membership or membership.get("role_in_course") != "teacher":
            raise HTTPException(status_code=403, detail="Zadání může z kurzu odebrat jen jeho správce.")
            
    cs_table = get_course_scenarios_table()
    try:
        from app.storage import get_scenarios_table
        from app.routers.materials import get_blob_service, get_blob_container_name
        import json

        try:
            cs_entity = cs_table.get_entity(partition_key=course_id, row_key=scenario_id)
            template_id = cs_entity.get("scenarioTemplateId")
            if template_id:
                sc_table = get_scenarios_table()
                sc_entity = sc_table.get_entity(partition_key="SCENARIO_TEMPLATE", row_key=template_id)
                task_config = sc_entity.get("taskConfigJson", "")
                if task_config:
                    config = json.loads(task_config)
                    blob_service = get_blob_service()
                    container_name = get_blob_container_name()
                    for variant in config.get("variants", []):
                        for task in variant.get("tasks", []):
                            img_url = task.get("imageUrl", "")
                            if task.get("type") == "image" and img_url and "/images/" in img_url:
                                encoded_blob = img_url.split("/images/")[-1]
                                blob_name = encoded_blob.replace("___", "/")
                                try:
                                    blob_service.get_blob_client(container=container_name, blob=blob_name).delete_blob()
                                except Exception:
                                    pass
        except Exception:
            pass

        cs_table.delete_entity(partition_key=course_id, row_key=scenario_id)
        return {"message": "Odebráno z kurzu a obrázky smazány."}
    except ResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Nenalezeno.")
    
class AIScenarioPayload(BaseModel):
    title: str
    description: str
    instructions: str
    gradingRubric: str
    requiredOs: str
    timeLimit: int
    hints: str

@router.post("/{course_id}/ai-scenarios")
def create_ai_scenario(course_id: str, payload: AIScenarioPayload, current_user=Depends(get_current_user)):
    if current_user.get("global_role") not in ["teacher", "admin"]:
        raise HTTPException(status_code=403, detail="Nedostatečná oprávnění k tvorbě AI scénářů.")

    clean_title = re.sub(r'[^\w-]', '', payload.title.lower().replace(' ', '-'))
    auto_id = f"{clean_title}-{random.randint(100, 999)}"
    
    tech_template_id = f"{auto_id}-tech"
    scenario_template_id = f"{auto_id}-template"
    course_scenario_id = auto_id

    _os_image_map = {
        "kali": "adaptivekoza01.azurecr.io/adaptive-lab-kali:v3",
        "ubuntu": "adaptivekoza01.azurecr.io/adaptive-lab-kali:ubuntu-v1",
        "none": "skip",
    }
    lab_image = _os_image_map.get(payload.requiredOs, "skip")

    # Pro none přeskočíme vytváření unikátní technické šablony a použijeme sdílenou base-none
    _use_base_none = payload.requiredOs == "none"
    if _use_base_none:
        tech_template_id = "base-none"

    try:
        table_client_labtemplates = get_labtemplates_table()

        if _use_base_none:
            # Sdílená base šablona — idempotentní
            try:
                table_client_labtemplates.get_entity(partition_key="LABTEMPLATE", row_key="base-none")
            except Exception:
                table_client_labtemplates.create_entity(entity={
                    "PartitionKey": "LABTEMPLATE",
                    "RowKey": "base-none",
                    "template_id": "base-none",
                    "title": "Žádné virtuální prostředí",
                    "labImage": "skip",
                    "fileShareName": "labs",
                    "mountPath": "/mnt/output",
                    "timeoutSeconds": 0,
                    "status": "active",
                })
        else:
            lab_template_entity = {
                "PartitionKey": "LABTEMPLATE",
                "RowKey": tech_template_id,
                "template_id": tech_template_id,
                "title": f"AI Mentor Lab ({payload.title})",
                "labImage": lab_image,
                "fileShareName": "labs",
                "mountPath": "/mnt/output",
                "timeoutSeconds": payload.timeLimit * 60,
                "cpu": 2,
                "memoryGb": 4,
                "createdBy": current_user["user_id"],
                "createdAt": utc_now_iso(),
                "status": "active"
            }
            table_client_labtemplates.create_entity(entity=lab_template_entity)

        table_client_scenariotemplates = get_scenarios_table()
        scenario_template_entity = {
            "PartitionKey": "SCENARIO_TEMPLATE",
            "RowKey": scenario_template_id,
            "scenario_template_id": scenario_template_id,
            "linked_template_id": tech_template_id,
            "title": payload.title,
            "description": payload.description,
            "instructions": payload.instructions, # Zde je schovaný "Goal" a "Persona"
            "hints": payload.hints, # Zde je uloženo [ADAPTIVE:true] a počty podúkolů
            "difficulty": "adaptive",
            "expectedOutputs": "AI_EVALUATED", 
            "gradingRubric": payload.gradingRubric,
            "requiredOs": payload.requiredOs,
            "createdBy": current_user["user_id"],
            "createdAt": utc_now_iso(),
            "status": "active"
        }
        table_client_scenariotemplates.create_entity(entity=scenario_template_entity)

        table_client_coursescenarios = get_course_scenarios_table()
        course_scenario_entity = {
            "PartitionKey": course_id,
            "RowKey": course_scenario_id,
            "courseScenarioId": course_scenario_id,
            "courseId": course_id,
            "scenarioTemplateId": scenario_template_id,
            "assignedBy": current_user["user_id"],
            "maxAttempts": 0, # AI tutor je nekonečně opakovatelný
            "deadline": "",
            "status": "active",
            "assignedAt": utc_now_iso()
        }
        table_client_coursescenarios.create_entity(entity=course_scenario_entity)

        return JSONResponse(status_code=201, content={"status": "success", "scenarioId": course_scenario_id})

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chyba při ukládání do Azure Table: {str(e)}")
    

@router.post("/{course_id}/scenarios/upload-image")
async def upload_scenario_image(
    course_id: str,
    file: UploadFile = File(...),
    current_user=Depends(get_current_user)
):
    membership = require_course_membership(course_id, current_user["user_id"])
    if membership.get("role_in_course") not in ["teacher", "admin"] and current_user.get("global_role") != "admin":
        raise HTTPException(status_code=403, detail="Pouze učitel může nahrávat obrázky.")

    ext = file.filename.split(".")[-1].lower() if "." in file.filename else "jpg"
    blob_name = f"scenarios/{course_id}/{uuid.uuid4().hex}.{ext}"

    blob_service = get_blob_service()
    container_name = get_blob_container_name()
    blob_client = blob_service.get_blob_client(container=container_name, blob=blob_name)
    
    file_content = await file.read()
    blob_client.upload_blob(file_content, overwrite=True)

    # Vrátíme cestu k proxy endpointu, který obrázek umí zobrazit (lomítka nahradíme kvůli URL parametrům)
    image_url = f"/courses/{course_id}/scenarios/images/{blob_name.replace('/', '___')}"
    return {"imageUrl": image_url}

@router.get("/{course_id}/scenarios/images/{blob_name_b64}")
def get_scenario_image(course_id: str, blob_name_b64: str):
    """ Tento endpoint funguje jako proxy. Vezme obrázek z Azure Blobu a rovnou ho vykreslí do prohlížeče. """
    blob_name = blob_name_b64.replace("___", "/")
    
    blob_service = get_blob_service()
    container_name = get_blob_container_name()
    blob_client = blob_service.get_blob_client(container=container_name, blob=blob_name)
    
    try:
        download_stream = blob_client.download_blob()
        data = download_stream.readall()
        
        ext = blob_name.split(".")[-1].lower()
        media_type = "image/jpeg"
        if ext == "png": media_type = "image/png"
        elif ext in ["gif", "webp", "bmp"]: media_type = f"image/{ext}"
        
        return Response(content=data, media_type=media_type)
    except Exception as e:
        raise HTTPException(status_code=404, detail="Obrázek nenalezen v Blob Storage")