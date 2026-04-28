import json
import logging
import os
import shlex
import re
from datetime import datetime, timezone

import azure.functions as func
from azure.core.exceptions import ResourceExistsError
from azure.data.tables import TableServiceClient, UpdateMode
from azure.identity import DefaultAzureCredential
from azure.mgmt.containerinstance import ContainerInstanceManagementClient
from azure.mgmt.containerinstance.models import (
    AzureFileVolume,
    Container,
    ContainerGroup,
    ContainerGroupRestartPolicy,
    EnvironmentVariable,
    ImageRegistryCredential,
    OperatingSystemTypes,
    ResourceRequests,
    ResourceRequirements,
    Volume,
    VolumeMount,
)

app = func.FunctionApp()


def upsert_attempt_metadata(
    attempt_id: str,
    scenario_id: str,
    status: str,
    artifact_path: str,
    created_at: str,
    finished_at: str | None = None,
    detail: str = "",
) -> None:
    connection_string = os.environ["AzureWebJobsStorage"]
    table_service = TableServiceClient.from_connection_string(connection_string)
    table_client = table_service.get_table_client("attempts")

    try:
        table_client.create_table()
    except ResourceExistsError:
        pass

    entity = {
        "PartitionKey": "attempts",
        "RowKey": attempt_id,
        "attemptId": attempt_id,
        "scenarioId": scenario_id,
        "status": status,
        "artifactPath": artifact_path,
        "createdAt": created_at,
        "finishedAt": finished_at or "",
        "detail": detail,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }
    table_client.upsert_entity(mode=UpdateMode.MERGE, entity=entity)


@app.queue_trigger(
    arg_name="msg",
    queue_name="lab-start",
    connection="AzureWebJobsStorage"
)
def queue_start_lab(msg: func.QueueMessage) -> None:
    raw = msg.get_body().decode("utf-8")
    logging.info("Received queue message: %s", raw)

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        logging.error("Queue message is not valid JSON.")
        return

    attempt_id = payload["attempt_id"]
    scenario_id = payload.get("scenario_id") or payload.get("assignment_id")
    if not scenario_id:
        raise ValueError("Queue payload neobsahuje scenario_id ani assignment_id.")

    lab_image = payload["lab_image"]
    container_group_name = payload["container_group_name"]
    container_group_name = re.sub(r"[^a-z0-9-]", "-", container_group_name.lower())
    container_group_name = re.sub(r"-+", "-", container_group_name).strip("-")[:63]
    file_share_name = payload.get("file_share_name", "labs")
    mount_path = payload.get("mount_path", "/mnt/output")
    artifact_path = payload.get(
        "artifact_path",
        f"labs/{scenario_id}/{attempt_id}/result.txt"
    )
    created_at = datetime.now(timezone.utc).isoformat()

    upsert_attempt_metadata(
        attempt_id=attempt_id,
        scenario_id=scenario_id,
        status="queued",
        artifact_path=artifact_path,
        created_at=created_at,
        finished_at=None,
        detail="Message received by queue trigger.",
    )

    subscription_id = os.environ["AZURE_SUBSCRIPTION_ID"]
    resource_group = os.environ["AZURE_RESOURCE_GROUP"]
    acr_server = os.environ["ACR_LOGIN_SERVER"]
    acr_username = os.environ["ACR_USERNAME"]
    acr_password = os.environ["ACR_PASSWORD"]
    storage_account_name = os.environ["LAB_STORAGE_ACCOUNT_NAME"]
    storage_account_key = os.environ["LAB_STORAGE_ACCOUNT_KEY"]

    credential = DefaultAzureCredential(exclude_interactive_browser_credential=False)
    client = ContainerInstanceManagementClient(credential, subscription_id)

    container_resource_requests = ResourceRequests(cpu=1.0, memory_in_gb=1.5)
    container_resource_requirements = ResourceRequirements(
        requests=container_resource_requests
    )

    volume_mount = VolumeMount(
        name="output",
        mount_path=mount_path,
        read_only=False,
    )
    output_dir = f"{mount_path}/{scenario_id}/{attempt_id}"
    output_file = f"{output_dir}/result.txt"
    result_text = f"AdaptivePlatform MVP result for {scenario_id} / {attempt_id}"

    container = Container(
        name=container_group_name,
        image=lab_image,
        resources=container_resource_requirements,
        volume_mounts=[volume_mount],
        environment_variables=[
            EnvironmentVariable(name="ATTEMPT_ID", value=attempt_id),
            EnvironmentVariable(name="SCENARIO_ID", value=scenario_id),
            EnvironmentVariable(name="ASSIGNMENT_ID", value=scenario_id),
            EnvironmentVariable(name="ARTIFACT_PATH", value=artifact_path),
            EnvironmentVariable(name="MOUNT_PATH", value=mount_path),
        ],

        command=[
            "/bin/bash",
            "-c",
            (
                f"mkdir -p {shlex.quote(output_dir)} && "
                f"printf '%s\n' {shlex.quote(result_text)} > {shlex.quote(output_file)}"
            ),
        ],
    )

    volume = Volume(
        name="output",
        azure_file=AzureFileVolume(
            share_name=file_share_name,
            storage_account_name=storage_account_name,
            storage_account_key=storage_account_key,
        ),
    )

    container_group = ContainerGroup(
        location="swedencentral",
        os_type=OperatingSystemTypes.linux,
        containers=[container],
        restart_policy=ContainerGroupRestartPolicy.never,
        image_registry_credentials=[
            ImageRegistryCredential(
                server=acr_server,
                username=acr_username,
                password=acr_password,
            )
        ],
        volumes=[volume],
    )

    try:
        upsert_attempt_metadata(
            attempt_id=attempt_id,
            scenario_id=scenario_id,
            status="running",
            artifact_path=artifact_path,
            created_at=created_at,
            finished_at=None,
            detail="Creating ACI container group.",
        )

        poller = client.container_groups.begin_create_or_update(
            resource_group_name=resource_group,
            container_group_name=container_group_name,
            container_group=container_group,
        )
        result = poller.result()

        provisioning_state = result.provisioning_state or "unknown"
        finished_at = datetime.now(timezone.utc).isoformat()

        upsert_attempt_metadata(
            attempt_id=attempt_id,
            scenario_id=scenario_id,
            status="running",
            artifact_path=artifact_path,
            created_at=created_at,
            finished_at=None,
            detail=f"ACI container group submitted. Provisioning state: {provisioning_state}",
        )

        logging.info(
            "ACI started for attempt_id=%s, scenario_id=%s, container_group_name=%s, provisioning_state=%s",
            attempt_id,
            scenario_id,
            container_group_name,
            provisioning_state,
        )

    except Exception as exc:
        finished_at = datetime.now(timezone.utc).isoformat()

        logging.exception("Failed to start ACI for attempt_id=%s", attempt_id)

        upsert_attempt_metadata(
            attempt_id=attempt_id,
            scenario_id=scenario_id,
            status="failed",
            artifact_path=artifact_path,
            created_at=created_at,
            finished_at=finished_at,
            detail=str(exc),
        )
        raise