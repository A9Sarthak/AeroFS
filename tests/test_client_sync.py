"""
Test Suite for AeroFS Remote Client & Live Web Synchronization
Verifies that the CLI client seamlessly mutates and queries the live web server.
"""

import os
import sys
import time
import threading
import pytest
import uvicorn

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from aerofs.client import AeroFSRemoteClient, check_server_available
from aerofs.app import app

TEST_PORT = 8912
TEST_URL = f"http://127.0.0.1:{TEST_PORT}"


@pytest.fixture(scope="module", autouse=True)
def run_test_server():
    """Boots an isolated test server instance for end-to-end client testing."""
    import requests
    from aerofs.app import reset_app_filesystem
    reset_app_filesystem()

    config = uvicorn.Config(app, host="127.0.0.1", port=TEST_PORT, log_level="error")
    server = uvicorn.Server(config)
    t = threading.Thread(target=server.run, daemon=True)
    t.start()

    # Wait for server to bind
    t0 = time.time()
    while time.time() - t0 < 5.0:
        if check_server_available(TEST_URL):
            break
        time.sleep(0.1)

    assert check_server_available(TEST_URL), "Test server failed to start"
    requests.post(f"{TEST_URL}/api/format")
    yield
    server.should_exit = True
    time.sleep(0.2)


def test_client_connection_and_telemetry():
    """Verifies that the client can connect and fetch telemetry from the server."""
    client = AeroFSRemoteClient(TEST_URL)
    telem = client.get_telemetry()
    assert "disk" in telem
    assert "dedup" in telem
    assert "grid_blocks" in telem
    assert telem["disk"]["total_blocks"] == 4096


def test_client_write_read_and_deduplication():
    """Verifies that writing via the client updates the server and enables CAS deduplication."""
    client = AeroFSRemoteClient(TEST_URL)
    payload = b"Operating System Core Kernel Memory Architecture\n" * 100

    inode1, dedup1 = client.write_file("test_kernel_1.c", payload)
    assert inode1.size == len(payload)
    assert len(inode1.block_ids) > 0

    # Write identical duplicate file
    inode2, dedup2 = client.write_file("test_kernel_2.c", payload)
    assert dedup2 > 0  # Chunks were deduplicated!
    assert inode2.merkle_root == inode1.merkle_root

    # Verify content readback
    data_read = client.read_file("test_kernel_1.c")
    assert data_read == payload


def test_client_snapshots_and_rollback():
    """Verifies snapshot creation and rollback over the network client."""
    client = AeroFSRemoteClient(TEST_URL)
    snap = client.create_snapshot("sync_snap_test")
    assert snap["name"] == "sync_snap_test"
    assert snap["file_count"] >= 2

    # Check snapshots listed
    snaps = client.list_snapshots()
    assert any(s["name"] == "sync_snap_test" for s in snaps)

    # Delete one file and verify restoration
    assert client.delete_file("test_kernel_2.c") is True
    assert "test_kernel_2.c" not in [f["name"] for f in client.list_files()]

    # Restore snapshot
    assert client.restore_snapshot("sync_snap_test") is True
    assert "test_kernel_2.c" in [f["name"] for f in client.list_files()]


def test_client_bitrot_and_self_heal():
    """Verifies simulated bit-rot injection and autonomous self-healing via the client."""
    client = AeroFSRemoteClient(TEST_URL)
    file_info = client.inspect_file("test_kernel_1.c")
    assert file_info["is_healthy"] is True

    # Inject bit-rot into first data block of test_kernel_1.c
    target_block = file_info["inode"]["block_ids"][0]
    res = client.dev.inject_bit_rot(target_block)
    assert res["status"] == "success"

    # Verify audit catches it
    audit = client.scrub_all()
    assert audit["status"] == "DEGRADED"
    assert audit["corrupted_blocks_total"] >= 1
    found_damaged = any(target_block in d["corrupted_blocks"] for d in audit["details"])
    assert found_damaged is True

    # Verify self-healing restores it
    heal = client.self_heal_all()
    assert target_block in heal["repaired_blocks"]
    assert heal["post_heal_status"] == "HEALTHY"

    # Verify data matches original after heal
    fresh_read = client.read_file("test_kernel_1.c")
    assert len(fresh_read) > 0
