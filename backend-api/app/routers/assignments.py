import json
import uuid
from typing import Any
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse, PlainTextResponse
from azure.core.exceptions import ResourceNotFoundError
from azure.data.tables import UpdateMode

from app.auth import get_current_user, require_course_membership, get_course_membership
from app.storage import get_assignments_table, get_attempts_table, get_lab_queue, build_artifact_path, get_file_share_name, read_artifact_text, utc_now_iso
from app.models.schemas import (
    AssignmentCreateRequest,
    AssignmentStartRequest,
)

router = APIRouter(tags=["Assignments and Attempts"])

@router.get("/assignments")
def list_assignments() -> list[dict[str, Any]]:
    table = get_assignments_table()
    items = []
    for entity in table.list_entities():
        items.append({
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
    items.sort(key=lambda x: x["assignmentId"] or "")
    return items

@router.get("/assignments/{assignment_id}")
def get_assignment(assignment_id: str) -> dict[str, Any]:
    table = get_assignments_table()
    try:
        entity = table.get_entity(partition_key="assignments", row_key=assignment_id)
    except ResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Assignment nebyl nalezen.")
    return {
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
    }

@router.post("/assignments")
def create_assignment(payload: AssignmentCreateRequest, current_user=Depends(get_current_user)) -> JSONResponse:
    table = get_assignments_table()
    membership = require_course_membership(payload.course_id, current_user["user_id"])

    if membership.get("role_in_course") not in ["teacher", "assistant"] and current_user.get("global_role") != "admin":
        raise HTTPException(status_code=403, detail="Jen učitel může vytvářet assignmenty v kurzu.")

    entity = {
        "PartitionKey": "assignments",
        "RowKey": payload.assignment_id,
        "assignmentId": payload.assignment_id,
        "course_id": payload.course_id,
        "created_by": current_user["user_id"],
        "status": "published",
        "assignment_type": "lab",
        "title": payload.title,
        "description": payload.description,
        "labImage": payload.lab_image,
        "fileShareName": payload.file_share_name,
        "mountPath": payload.mount_path,
        "createdAt": utc_now_iso(),
    }
    try:
        table.create_entity(entity=entity)
    except Exception as exc:
        raise HTTPException(status_code=409, detail=f"Assignment už existuje nebo nejde vytvořit: {exc}")
    return JSONResponse(status_code=201, content={"message": "Assignment created.", "assignmentId": payload.assignment_id})

@router.post("/assignments/{assignment_id}/start")
def start_assignment(assignment_id: str, payload: AssignmentStartRequest, current_user=Depends(get_current_user)) -> JSONResponse:
    assignments = get_assignments_table()
    attempts = get_attempts_table()

    try:
        assignment = assignments.get_entity(partition_key="assignments", row_key=assignment_id)
    except ResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Assignment nebyl nalezen.")

    course_id = assignment.get("course_id")
    if not course_id:
        raise HTTPException(status_code=500, detail="Assignment nemá přiřazené course_id.")

    membership = require_course_membership(course_id, current_user["user_id"])
    if current_user.get("global_role") == "student" and membership.get("role_in_course") != "student":
        raise HTTPException(status_code=403, detail="Student nemá v kurzu studentskou roli.")

    attempt_id = payload.attempt_id or f"attempt-{uuid.uuid4().hex[:8]}"
    artifact_path = build_artifact_path(assignment_id, attempt_id)
    created_at = utc_now_iso()
    container_group_name = f"aci-{assignment_id}-{attempt_id}"[:63]

    attempt_entity = {
        "PartitionKey": "attempts",
        "RowKey": attempt_id,
        "attemptId": attempt_id,
        "assignmentId": assignment_id,
        "courseId": course_id,
        "userId": current_user["user_id"],
        "userRole": current_user.get("global_role"),
        "status": "queued",
        "artifactPath": artifact_path,
        "createdAt": created_at,
        "finishedAt": "",
        "detail": "Attempt created by backend API and queued for processing.",
        "updatedAt": created_at,
        "runNumber": 1,
    }
    attempts.upsert_entity(mode=UpdateMode.MERGE, entity=attempt_entity)

    queue_payload: dict[str, Any] = {
        "attempt_id": attempt_id,
        "assignment_id": assignment_id,
        "course_id": course_id,
        "user_id": current_user["user_id"],
        "user_role": current_user.get("global_role"),
        "lab_image": assignment["labImage"],
        "container_group_name": container_group_name,
        "file_share_name": assignment.get("fileShareName", get_file_share_name()),
        "mount_path": assignment.get("mountPath", "/mnt/output"),
        "artifact_path": artifact_path,
    }
    queue_client = get_lab_queue()
    queue_client.send_message(json.dumps(queue_payload))

    return JSONResponse(status_code=202, content={
        "message": "Attempt queued.",
        "assignmentId": assignment_id,
        "courseId": course_id,
        "attemptId": attempt_id,
        "userId": current_user["user_id"],
        "status": "queued",
        "artifactPath": artifact_path,
    })

@router.get("/attempts/{attempt_id}")
def get_attempt(attempt_id: str, current_user=Depends(get_current_user)) -> dict[str, Any]:
    attempts = get_attempts_table()
    try:
        entity = attempts.get_entity(partition_key="attempts", row_key=attempt_id)
    except ResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Attempt nebyl nalezen.")

    attempt_user_id = entity.get("userId", "")
    attempt_course_id = entity.get("courseId", "")

    if current_user.get("global_role") == "student":
        if attempt_user_id != current_user.get("user_id"):
            raise HTTPException(status_code=403, detail="Student nemůže číst cizí attempt.")
    elif current_user.get("global_role") == "teacher":
        membership = get_course_membership(attempt_course_id, current_user.get("user_id"))
        if not membership or membership.get("role_in_course") not in ["teacher", "assistant"]:
            raise HTTPException(status_code=403, detail="Učitel nemá přístup k tomuto attemptu.")

    return {
        "attemptId": entity.get("attemptId"),
        "assignmentId": entity.get("assignmentId", ""),
        "scenarioId": entity.get("scenarioId", ""),
        "templateId": entity.get("templateId", ""),
        "courseId": entity.get("courseId", ""),
        "userId": entity.get("userId", ""),
        "userRole": entity.get("userRole", ""),
        "status": entity.get("status"),
        "learningStatus": entity.get("learningStatus", ""),
        "artifactPath": entity.get("artifactPath"),
        "createdAt": entity.get("createdAt"),
        "finishedAt": entity.get("finishedAt"),
        "detail": entity.get("detail", ""),
        "updatedAt": entity.get("updatedAt", ""),
        "submissionNote": entity.get("submissionNote", ""),
        "submittedAt": entity.get("submittedAt", ""),
        "submittedArtifactPath": entity.get("submittedArtifactPath", ""),
        "feedbackText": entity.get("feedbackText", ""),
        "feedbackAt": entity.get("feedbackAt", ""),
        "runNumber": entity.get("runNumber", 1),
    }

"""
@router.post("/attempts/{attempt_id}/submit")
def submit_attempt(attempt_id: str, payload: AttemptSubmitRequest, current_user=Depends(get_current_user)) -> JSONResponse:
    attempts = get_attempts_table()

    try:
        entity = attempts.get_entity(partition_key="attempts", row_key=attempt_id)
    except ResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Attempt nebyl nalezen.")

    if current_user.get("global_role") != "student":
        raise HTTPException(status_code=403, detail="Odevzdání může provést pouze student.")

    if entity.get("userId") != current_user.get("user_id"):
        raise HTTPException(status_code=403, detail="Student nemůže odevzdat cizí attempt.")

    if entity.get("status") != "succeeded":
        raise HTTPException(status_code=409, detail="Odevzdat lze až po úspěšném dokončení běhu.")

    if entity.get("learningStatus") == "evaluated":
        raise HTTPException(status_code=409, detail="Pokus už byl vyhodnocen a nelze jej znovu odevzdat.")

    submitted_at = utc_now_iso()

    attempts.upsert_entity(
        mode=UpdateMode.MERGE,
        entity={
            "PartitionKey": "attempts",
            "RowKey": attempt_id,
            "learningStatus": "submitted",
            "submissionNote": payload.submission_note,
            "submittedAt": submitted_at,
            "submittedArtifactPath": entity.get("artifactPath", ""),
            "updatedAt": submitted_at,
        }
    )

    return JSONResponse(
        status_code=200,
        content={
            "message": "Attempt submitted.",
            "attemptId": attempt_id,
            "learningStatus": "submitted",
            "submittedAt": submitted_at,
        }
    )

@router.post("/attempts/{attempt_id}/evaluate")
def evaluate_attempt(attempt_id: str, payload: AttemptEvaluateRequest, current_user=Depends(get_current_user)) -> JSONResponse:
    attempts = get_attempts_table()

    try:
        entity = attempts.get_entity(partition_key="attempts", row_key=attempt_id)
    except ResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Attempt nebyl nalezen.")

    course_id = entity.get("courseId", "")
    membership = get_course_membership(course_id, current_user.get("user_id"))

    if current_user.get("global_role") != "admin":
        if not membership or membership.get("role_in_course") not in ["teacher", "assistant"]:
            raise HTTPException(status_code=403, detail="Zpětnou vazbu může uložit pouze učitel nebo asistent kurzu.")

    learning_status = entity.get("learningStatus", "")
    if learning_status not in ["submitted", "evaluated"]:
        raise HTTPException(
            status_code=409,
            detail="Hodnotit lze pouze odevzdaný nebo již vyhodnocený pokus."
        )

    feedback_at = utc_now_iso()

    attempts.upsert_entity(
        mode=UpdateMode.MERGE,
        entity={
            "PartitionKey": "attempts",
            "RowKey": attempt_id,
            "learningStatus": "evaluated",
            "feedbackText": payload.feedback_text,
            "feedbackAt": feedback_at,
            "score": payload.score,
            "reviewedBy": current_user.get("user_id"),
            "updatedAt": feedback_at,
        }
    )

    return JSONResponse(
        status_code=200,
        content={
            "message": "Attempt evaluated.",
            "attemptId": attempt_id,
            "learningStatus": "evaluated",
            "feedbackAt": feedback_at,
            "score": payload.score,
            "reviewedBy": current_user.get("user_id"),
        }
    )
"""


@router.get("/attempts/{attempt_id}/artifact")
def get_attempt_artifact(attempt_id: str, current_user=Depends(get_current_user)) -> PlainTextResponse:
    attempts = get_attempts_table()
    try:
        entity = attempts.get_entity(partition_key="attempts", row_key=attempt_id)
    except ResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Attempt nebyl nalezen.")

    attempt_user_id = entity.get("userId", "")
    attempt_course_id = entity.get("courseId", "")

    if current_user.get("global_role") == "student":
        if attempt_user_id != current_user.get("user_id"):
            raise HTTPException(status_code=403, detail="Student nemůže číst cizí artefakt.")
    elif current_user.get("global_role") == "teacher":
        membership = get_course_membership(attempt_course_id, current_user.get("user_id"))
        if not membership or membership.get("role_in_course") not in ["teacher", "assistant"]:
            raise HTTPException(status_code=403, detail="Učitel nemá přístup k tomuto artefaktu.")

    artifact_path = entity.get("artifactPath", "")
    content = read_artifact_text(artifact_path)
    return PlainTextResponse(content)

@router.post("/attempts/{attempt_id}/refresh")
def refresh_attempt(attempt_id: str, current_user=Depends(get_current_user)) -> dict[str, Any]:
    attempts = get_attempts_table()

    try:
        entity = attempts.get_entity(partition_key="attempts", row_key=attempt_id)
    except ResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Attempt nebyl nalezen.")

    if current_user.get("global_role") == "student" and entity.get("userId") != current_user.get("user_id"):
        raise HTTPException(status_code=403, detail="Student nemůže číst cizí attempt.")

    artifact_path = entity.get("artifactPath", "")
    artifact_exists = False

    if artifact_path:
        try:
            read_artifact_text(artifact_path)
            artifact_exists = True
        except HTTPException:
            artifact_exists = False

    if entity.get("status") == "running" and artifact_exists:
        updated_at = utc_now_iso()
        attempts.upsert_entity(
            mode=UpdateMode.MERGE,
            entity={
                "PartitionKey": "attempts",
                "RowKey": attempt_id,
                "status": "succeeded",
                "finishedAt": updated_at,
                "updatedAt": updated_at,
                "detail": "Artifact found in Azure Files. Attempt finalized as succeeded.",
            }
        )
        entity = attempts.get_entity(partition_key="attempts", row_key=attempt_id)

    return {
        "attemptId": entity.get("attemptId"),
        "assignmentId": entity.get("assignmentId", ""),
        "scenarioId": entity.get("scenarioId", ""),
        "templateId": entity.get("templateId", ""),
        "courseId": entity.get("courseId", ""),
        "userId": entity.get("userId", ""),
        "userRole": entity.get("userRole", ""),
        "status": entity.get("status"),
        "learningStatus": entity.get("learningStatus", ""),
        "artifactPath": entity.get("artifactPath"),
        "createdAt": entity.get("createdAt"),
        "finishedAt": entity.get("finishedAt"),
        "detail": entity.get("detail", ""),
        "updatedAt": entity.get("updatedAt", ""),
        "submissionNote": entity.get("submissionNote", ""),
        "submittedAt": entity.get("submittedAt", ""),
        "submittedArtifactPath": entity.get("submittedArtifactPath", ""),
        "feedbackText": entity.get("feedbackText", ""),
        "feedbackAt": entity.get("feedbackAt", ""),
        "score": entity.get("score", None),
        "runNumber": entity.get("runNumber", 1),
    }