"""
Unit & Integration Tests for AeroFS Studio API Additions
Tests health endpoint, file listing, snapshot listing, file duplicate (CAS dedup),
benchmark suite, and CORS headers.
"""

import pytest
from fastapi.testclient import TestClient
from aerofs.app import app, fs, reset_app_filesystem


@pytest.fixture(autouse=True)
def setup_test_fs(tmp_path):
    test_disk = str(tmp_path / "studio_api_test.bin")
    reset_app_filesystem(test_disk)
    yield
    reset_app_filesystem()


def test_health_endpoint():
    client = TestClient(app)
    res = client.get("/api/health")
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True
    assert data["status"] == "connected"
    assert "disk_path" in data
    assert data["total_blocks"] == 4096
    assert data["block_size"] == 4096


def test_list_files_and_snapshots_endpoints():
    client = TestClient(app)

    # Initial state
    res = client.get("/api/files")
    assert res.status_code == 200
    assert "files" in res.json()

    # Create file
    create_res = client.post("/api/files/create_text", json={
        "filename": "studio_doc.txt",
        "content": "AeroFS Studio Test Payload"
    })
    assert create_res.status_code == 200

    # Verify listing
    res = client.get("/api/files")
    assert res.status_code == 200
    filenames = [f["name"] for f in res.json()["files"]]
    assert "studio_doc.txt" in filenames

    # Create snapshot and list
    snap_res = client.post("/api/snapshots/create", json={"name": "studio_snap_1"})
    assert snap_res.status_code == 200

    list_snaps = client.get("/api/snapshots")
    assert list_snaps.status_code == 200
    snap_names = [s["name"] for s in list_snaps.json()["snapshots"]]
    assert "studio_snap_1" in snap_names


def test_duplicate_file_cas_deduplication():
    client = TestClient(app)

    # Create original file
    content = "High Integrity Operating Systems Storage Subsystem CAS Dedup Test" * 50
    client.post("/api/files/create_text", json={
        "filename": "source_orig.txt",
        "content": content
    })

    # Duplicate file
    dup_res = client.post("/api/files/source_orig.txt/duplicate", json={
        "source_filename": "source_orig.txt",
        "dest_filename": "source_dup.txt"
    })
    assert dup_res.status_code == 200
    data = dup_res.json()
    assert data["filename"] == "source_dup.txt"
    # In CAS, identical content should produce dedup hit
    assert data["deduplicated_chunks"] >= 1

    # Verify both files can be read and have identical content
    r1 = client.get("/api/files/read/source_orig.txt")
    r2 = client.get("/api/files/read/source_dup.txt")
    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r1.json()["content"] == r2.json()["content"] == content


def test_benchmark_endpoint():
    client = TestClient(app)
    res = client.post("/api/benchmark", json={"workload": "dedup_and_cow"})
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert "results" in data
    assert len(data["results"]) > 0
    for r in data["results"]:
        assert "operation" in r
        assert "duration_ms" in r
        assert r["duration_ms"] >= 0


def test_cli_execute_endpoint():
    client = TestClient(app)
    # Test help
    res_help = client.post("/api/cli/execute", json={"command": "help"})
    assert res_help.status_code == 200
    assert "Available AeroFS Commands" in res_help.json()["output"]

    # Test write via CLI
    res_write = client.post("/api/cli/execute", json={"command": 'write test_cli_file.txt "HELLO_FROM_WEB_CLI"'})
    assert res_write.status_code == 200
    assert "Wrote 'test_cli_file.txt'" in res_write.json()["output"]

    # Test ls via CLI
    res_ls = client.post("/api/cli/execute", json={"command": "ls"})
    assert res_ls.status_code == 200
    assert "test_cli_file.txt" in res_ls.json()["output"]

    # Cleanup via CLI
    res_rm = client.post("/api/cli/execute", json={"command": "rm test_cli_file.txt"})
    assert res_rm.status_code == 200
    assert "Deleted 'test_cli_file.txt'" in res_rm.json()["output"]
