import os
from datetime import datetime, timezone
from fastapi import HTTPException
from azure.core.exceptions import ResourceExistsError, ResourceNotFoundError
from azure.data.tables import TableServiceClient
from azure.storage.queue import QueueClient
from azure.storage.fileshare import ShareFileClient

def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

def get_storage_connection_string() -> str:
    conn = os.getenv("STORAGE_CONNECTION_STRING") or os.getenv("AzureWebJobsStorage")
    if not conn:
        raise RuntimeError("Chybí STORAGE_CONNECTION_STRING i AzureWebJobsStorage.")
    return conn

def get_table_service() -> TableServiceClient:
    return TableServiceClient.from_connection_string(get_storage_connection_string())

def ensure_table(table_name: str):
    service = get_table_service()
    client = service.get_table_client(table_name=table_name)
    try:
        client.create_table()
    except ResourceExistsError:
        pass
    return client

def get_assignments_table(): return ensure_table(os.getenv("ASSIGNMENTS_TABLE_NAME", "assignments"))
def get_attempts_table():    return ensure_table(os.getenv("ATTEMPTS_TABLE_NAME", "attempts"))
def get_users_table():       return ensure_table(os.getenv("USERS_TABLE_NAME", "users"))
def get_courses_table():     return ensure_table(os.getenv("COURSES_TABLE_NAME", "courses"))
def get_coursemembers_table(): return ensure_table(os.getenv("COURSEMEMBERS_TABLE_NAME", "coursemembers"))
def get_labtemplates_table(): return ensure_table(os.getenv("LABTEMPLATES_TABLE_NAME", "labtemplates"))
def get_scenarios_table():    return ensure_table(os.getenv("SCENARIOS_TABLE_NAME", "scenarios"))
def get_course_scenarios_table(): return ensure_table(os.getenv("COURSE_SCENARIOS_TABLE_NAME", "coursescenarios"))
def get_submissions_table(): return ensure_table(os.getenv("SUBMISSIONS_TABLE_NAME", "submissions"))
def get_groups_table():       return ensure_table(os.getenv("GROUPS_TABLE_NAME", "groups"))
def get_groupmembers_table(): return ensure_table(os.getenv("GROUPMEMBERS_TABLE_NAME", "groupmembers"))

def get_lab_queue() -> QueueClient:
    queue_name = os.getenv("LAB_QUEUE_NAME", "lab-start")
    client = QueueClient.from_connection_string(conn_str=get_storage_connection_string(), queue_name=queue_name)
    try:
        client.create_queue()
    except ResourceExistsError:
        pass
    return client

def build_artifact_path(assignment_id: str, attempt_id: str) -> str:
    return f"labs/{assignment_id}/{attempt_id}/result.txt"

def get_file_share_name() -> str:
    return os.getenv("LAB_FILE_SHARE_NAME", "labs")

def read_artifact_text(artifact_path: str) -> str:
    if not artifact_path:
        raise HTTPException(status_code=404, detail="Pokus zatím nemá artifactPath.")
    normalized = artifact_path.strip("/")
    parts = normalized.split("/")
    if len(parts) < 2:
        raise HTTPException(status_code=400, detail="artifactPath má neplatný formát.")
    share_name = parts[0]
    file_path = "/".join(parts[1:])
    file_client = ShareFileClient.from_connection_string(
        conn_str=get_storage_connection_string(),
        share_name=share_name,
        file_path=file_path,
    )
    try:
        downloader = file_client.download_file()
        return downloader.readall().decode("utf-8")
    except ResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Artefakt nebyl nalezen.")
    
def get_lab_sessions_table(): 
    return ensure_table(os.getenv("LAB_SESSIONS_TABLE_NAME", "labsessions"))