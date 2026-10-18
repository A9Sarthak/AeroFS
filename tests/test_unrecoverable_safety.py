"""
test_unrecoverable_safety.py
============================

Automated tests that prove AeroFS refuses to return corrupted data to user-space
when BOTH recovery sources (Tier-1 recovery cache and Tier-2 snapshots) are
missing or corrupted.

The tests confirm three precise behaviours:

  1. self_heal_all() reports DEGRADED status + block listed in unrecoverable_blocks
     when both tiers fail.
  2. read_file(filename) raises IntegrityError (subclass of IOError/EIO) instead of
     silently returning the corrupt bytes — this is the critical safety guarantee.
  3. read_file(filename, verify_integrity=False) returns raw bytes without raising,
     enabling forensic inspection without corrupting the guarantee for normal callers.

No third recovery source is added. The goal is safe failure, not hiding it.
"""

import hashlib
import pytest
from aerofs import AeroFileSystem, IntegrityError


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_fs(tmp_path, name="disk.bin", blocks=512):
    """Returns a freshly formatted AeroFileSystem."""
    path = str(tmp_path / name)
    fs = AeroFileSystem(path, total_blocks=blocks, enable_journal=False)
    fs.format()
    return fs


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# ---------------------------------------------------------------------------
# 1.  self_heal_all() reports failure correctly when both tiers are absent
# ---------------------------------------------------------------------------

class TestSelfHealReportsDegradedStatus:

    def test_heal_reports_unrecoverable_block_when_cache_and_snapshots_both_missing(self, tmp_path):
        """
        Baseline: no cache, no snapshots → heal must report the block as unrecoverable
        and post_heal_status must be DEGRADED.
        """
        fs = _make_fs(tmp_path)
        inode, _ = fs.write_file("victim.txt", b"DEADBEEF" * 500)
        bid = inode.block_ids[0]
        expected_leaf_hash = inode.leaf_hashes[0]

        # --- preconditions ---
        assert bid in fs.recovery_cache, "cache should be warm after write"
        assert not fs.snapshots, "no snapshots should exist"

        # --- remove Tier-1 (recovery cache) ---
        fs.recovery_cache.pop(bid, None)
        assert bid not in fs.recovery_cache

        # --- corrupt the block (Tier-2 snapshot store is also empty) ---
        fs.dev.inject_bit_rot(bid)

        # --- run full self-heal ---
        result = fs.self_heal_all()

        # heal must not have succeeded
        assert bid in result["unrecoverable_blocks"], (
            f"Block {bid} should be in unrecoverable_blocks; got {result['unrecoverable_blocks']}"
        )
        assert result["unrecoverable_count"] >= 1
        assert bid not in result["repaired_blocks"], "unrecoverable block must not appear as repaired"

        # overall status must be DEGRADED
        assert result["post_heal_status"] == "DEGRADED", (
            f"Expected DEGRADED, got {result['post_heal_status']!r}"
        )

        # Verify the heal record itself
        failed_recs = [r for r in result["heal_records"] if r["block_id"] == bid]
        assert len(failed_recs) == 1
        assert failed_recs[0]["success"] is False
        assert failed_recs[0]["source"] == "failed", (
            f"Expected source='failed', got {failed_recs[0]['source']!r}"
        )

    def test_heal_reports_unrecoverable_when_snapshot_extent_store_also_missing(self, tmp_path):
        """
        Tier-2 snapshot extent store entries are also removed before corruption.
        Ensure heal still reports DEGRADED and does not hallucinate a recovery.
        """
        fs = _make_fs(tmp_path)
        inode, _ = fs.write_file("critical.bin", b"IMPORTANT" * 400)
        bid = inode.block_ids[0]

        # Take a snapshot — but then wipe its extent store (simulate snapshot store loss)
        fs.create_snapshot("snap_before_corrupt")
        fs.snapshot_extent_store.pop("snap_before_corrupt", None)

        # Remove cache too
        fs.recovery_cache.pop(bid, None)

        # Corrupt the block
        fs.dev.inject_bit_rot(bid)

        result = fs.self_heal_all()

        assert bid in result["unrecoverable_blocks"]
        assert result["post_heal_status"] == "DEGRADED"

    def test_leaf_hash_not_overwritten_with_corrupt_value_on_failed_heal(self, tmp_path):
        """
        A failed heal MUST NOT update inode.leaf_hashes with the corrupt digest.
        Doing so would cause future scrubs to report HEALTHY for a damaged file —
        a catastrophic silent data corruption.
        """
        fs = _make_fs(tmp_path)
        inode, _ = fs.write_file("safety.bin", b"SAFE_DATA" * 300)
        bid = inode.block_ids[0]
        original_leaf_hash = inode.leaf_hashes[0]

        fs.recovery_cache.pop(bid, None)
        fs.dev.inject_bit_rot(bid)
        corrupt_hash = _sha256(fs.dev.read_block(bid))

        assert corrupt_hash != original_leaf_hash, "bit-rot must change the hash"

        fs.self_heal_all()

        current_leaf_hash = fs.files["safety.bin"].leaf_hashes[0]
        assert current_leaf_hash == original_leaf_hash, (
            f"CRITICAL BUG: leaf_hash was overwritten with corrupt value {current_leaf_hash!r}. "
            f"Future scrubs would falsely report HEALTHY."
        )
        assert current_leaf_hash != corrupt_hash, (
            "leaf_hash must never hold the corrupt digest"
        )


# ---------------------------------------------------------------------------
# 2.  read_file() must raise IntegrityError — never return corrupted bytes
# ---------------------------------------------------------------------------

class TestReadFileRaisesIntegrityErrorWhenUnrecoverable:

    def test_read_raises_integrity_error_when_both_tiers_fail(self, tmp_path):
        """
        THE CORE SAFETY TEST.

        After bit-rot with both cache and snapshots absent, calling read_file()
        must raise IntegrityError (subclass of IOError) — not silently return
        the corrupted bytes.
        """
        fs = _make_fs(tmp_path)
        original_content = b"CONFIDENTIAL_PAYLOAD_" * 200
        inode, _ = fs.write_file("secret.dat", original_content)
        bid = inode.block_ids[0]

        # Ensure both tiers are absent
        fs.recovery_cache.pop(bid, None)
        assert not fs.snapshots

        # Corrupt the block on disk
        fs.dev.inject_bit_rot(bid)

        # This must NOT return corrupted data — it must raise
        with pytest.raises(IntegrityError) as exc_info:
            _ = fs.read_file("secret.dat")

        msg = str(exc_info.value)
        assert "EIO" in msg, f"Error message must contain 'EIO', got: {msg!r}"
        assert "secret.dat" in msg, f"Error message must name the file, got: {msg!r}"

    def test_read_raises_integrity_error_is_subclass_of_ioerror(self, tmp_path):
        """
        IntegrityError must be catchable as IOError so POSIX-aware callers
        receive the standard errno=EIO signal.
        """
        fs = _make_fs(tmp_path)
        inode, _ = fs.write_file("posix.txt", b"POSIX_DATA" * 300)
        bid = inode.block_ids[0]
        fs.recovery_cache.pop(bid, None)
        fs.dev.inject_bit_rot(bid)

        # Must be catchable as IOError (the POSIX convention)
        with pytest.raises(IOError):
            fs.read_file("posix.txt")

    def test_read_raises_only_for_corrupt_block_not_clean_file(self, tmp_path):
        """
        IntegrityError must be raised ONLY for the file whose block is corrupt.
        A second, clean file must still be readable without error.
        """
        fs = _make_fs(tmp_path)
        inode_bad, _ = fs.write_file("corrupt.txt", b"BAD_DATA_XYZ" * 300)
        good_content = b"GOOD_FILE_CONTENT_" * 200
        inode_good, _ = fs.write_file("clean.txt", good_content)

        bid_bad = inode_bad.block_ids[0]
        fs.recovery_cache.pop(bid_bad, None)
        fs.dev.inject_bit_rot(bid_bad)

        # Corrupt file must raise
        with pytest.raises(IntegrityError):
            fs.read_file("corrupt.txt")

        # Clean file must still read fine
        assert fs.read_file("clean.txt") == good_content

    def test_read_heals_and_succeeds_when_cache_available(self, tmp_path):
        """
        When Tier-1 (cache) is available, read_file() must silently self-heal
        on-demand and return the correct data — no exception raised.
        """
        fs = _make_fs(tmp_path)
        original = b"HEALABLE_CONTENT_" * 250
        inode, _ = fs.write_file("healable.txt", original)
        bid = inode.block_ids[0]

        # Cache remains — only corrupt the physical block
        assert bid in fs.recovery_cache
        fs.dev.inject_bit_rot(bid)

        # read_file should silently heal and return correct data
        result = fs.read_file("healable.txt")
        assert result == original, (
            "read_file must return original data after on-demand Tier-1 heal"
        )

    def test_read_heals_and_succeeds_when_snapshot_available(self, tmp_path):
        """
        When Tier-2 (snapshot extent store) is available and cache is absent,
        read_file() must silently self-heal and return the correct data.
        """
        fs = _make_fs(tmp_path)
        original = b"SNAP_HEALABLE_" * 300
        inode, _ = fs.write_file("snappable.txt", original)
        bid = inode.block_ids[0]

        fs.create_snapshot("clean_snap")
        fs.recovery_cache.pop(bid, None)
        assert bid in fs.snapshot_extent_store.get("clean_snap", {}), \
            "snapshot extent store must hold the block after create_snapshot"

        fs.dev.inject_bit_rot(bid)

        result = fs.read_file("snappable.txt")
        assert result == original, (
            "read_file must return original data after on-demand Tier-2 heal via snapshot"
        )

    def test_read_raises_when_all_snapshot_extents_are_wiped(self, tmp_path):
        """
        Snapshot exists but its extent store has been wiped (simulating snapshot
        store loss). Both tiers fail → IntegrityError must be raised.
        """
        fs = _make_fs(tmp_path)
        inode, _ = fs.write_file("doomed.dat", b"DOOMED_BYTES_" * 300)
        bid = inode.block_ids[0]

        fs.create_snapshot("wiped_snap")
        # Simulate extent store loss
        fs.snapshot_extent_store["wiped_snap"].pop(bid, None)
        fs.recovery_cache.pop(bid, None)
        fs.dev.inject_bit_rot(bid)

        with pytest.raises(IntegrityError):
            fs.read_file("doomed.dat")


# ---------------------------------------------------------------------------
# 3.  verify_integrity=False returns raw bytes (forensic mode, no exception)
# ---------------------------------------------------------------------------

class TestReadFileForensicMode:

    def test_forensic_mode_returns_raw_corrupt_bytes_without_raising(self, tmp_path):
        """
        read_file(filename, verify_integrity=False) must return raw bytes even
        when the block is corrupt — no integrity check, no exception.
        This is an opt-in forensic / debug escape-hatch.
        """
        fs = _make_fs(tmp_path)
        original = b"ORIGINAL_BEFORE_BITROT_" * 180
        inode, _ = fs.write_file("forensic.dat", original)
        bid = inode.block_ids[0]

        fs.recovery_cache.pop(bid, None)
        fs.dev.inject_bit_rot(bid)

        # Must NOT raise — returns whatever bytes are on disk
        raw = fs.read_file("forensic.dat", verify_integrity=False)
        assert isinstance(raw, bytes), "forensic mode must return bytes"
        assert len(raw) == len(original), "forensic mode must return correct length"
        # The data will be different because of bit-rot
        assert raw != original, "forensic mode should return the corrupt (mutated) bytes"

    def test_default_mode_still_raises_for_same_file(self, tmp_path):
        """
        Confirm the contrast: same scenario, default verify_integrity=True raises,
        while verify_integrity=False does not.
        """
        fs = _make_fs(tmp_path)
        original = b"CONTRAST_TEST_DATA_" * 200
        inode, _ = fs.write_file("contrast.dat", original)
        bid = inode.block_ids[0]

        fs.recovery_cache.pop(bid, None)
        fs.dev.inject_bit_rot(bid)

        # Default mode must raise
        with pytest.raises(IntegrityError):
            fs.read_file("contrast.dat")

        # Forensic mode must succeed
        raw = fs.read_file("contrast.dat", verify_integrity=False)
        assert isinstance(raw, bytes)


# ---------------------------------------------------------------------------
# 4.  REST API layer: HTTP 500 for unrecoverable reads
# ---------------------------------------------------------------------------

class TestAPIReturns500ForUnrecoverableRead:

    def test_api_read_returns_500_when_both_tiers_fail(self, tmp_path):
        """
        The REST endpoint GET /api/files/read/{filename} must return HTTP 500
        with an informative error message when read_file raises IntegrityError.
        """
        from fastapi.testclient import TestClient
        from aerofs.app import app, reset_app_filesystem, fs as app_fs

        disk = str(tmp_path / "api_test.bin")
        reset_app_filesystem(disk_path=disk)

        # Re-import fs after reset
        import aerofs.app as aerofs_app
        aerofs_app.fs.format()

        inode, _ = aerofs_app.fs.write_file("api_victim.txt", b"API_PAYLOAD_" * 300)
        bid = inode.block_ids[0]
        aerofs_app.fs.recovery_cache.pop(bid, None)
        aerofs_app.fs.dev.inject_bit_rot(bid)

        client = TestClient(app, raise_server_exceptions=False)
        response = client.get("/api/files/read/api_victim.txt")

        assert response.status_code == 500, (
            f"Expected HTTP 500, got {response.status_code}. Body: {response.text}"
        )
        body = response.text
        assert "EIO" in body or "integrity" in body.lower() or "corrupted" in body.lower(), (
            f"Response body must describe the integrity failure. Got: {body!r}"
        )


# ---------------------------------------------------------------------------
# 5.  Canonical end-to-end scenario (exactly as specified by the user)
#
#   Step 1 — Write a file and record its original SHA-256 hash.
#   Step 2 — Corrupt one block of the file.
#   Step 3 — Remove both recovery sources (cache + snapshot extent store).
#   Step 4 — Attempt to read the file.
#   Confirm — Read raises IntegrityError; corrupted bytes are NOT returned.
#   Bonus  — With a valid recovery source present, same read succeeds and
#             restores the original verified bytes.
# ---------------------------------------------------------------------------

class TestCanonicalEndToEndScenario:
    """
    Single-file, step-by-step demonstration of the core safety guarantee.
    Mirrors precisely the scenario the OS project specification calls for.
    """

    def _write_and_hash(self, fs, filename: str, payload: bytes):
        """Write file and return (inode, original_sha256)."""
        inode, _ = fs.write_file(filename, payload)
        original_hash = _sha256(payload)
        return inode, original_hash

    # ------------------------------------------------------------------
    # Scenario A — both tiers absent → read must raise, not return corrupt
    # ------------------------------------------------------------------

    def test_step_by_step_both_tiers_missing_raises_integrity_error(self, tmp_path):
        """
        CANONICAL SAFETY TEST — verbatim 4-step scenario.

        Step 1: Write a file → record SHA-256 of original bytes.
        Step 2: Corrupt one physical block.
        Step 3: Remove both recovery sources (cache + all snapshot extents).
        Step 4: Attempt to read the file.
        Assert: IntegrityError is raised — corrupted bytes are never returned.
        """
        fs = _make_fs(tmp_path, "canonical.bin")
        payload = b"CANONICAL_PAYLOAD_DATA_" * 220   # ~5 KB, spans at least 2 blocks

        # --- Step 1: write & hash ---
        inode, original_sha256 = self._write_and_hash(fs, "target.dat", payload)
        bid = inode.block_ids[0]                     # target the first block

        # Sanity: reading immediately after write must return original bytes
        assert _sha256(fs.read_file("target.dat")) == original_sha256, \
            "Immediate read-back must match original SHA-256"

        # --- Step 2: corrupt the block ---
        pre_corrupt_bytes = fs.dev.read_block(bid)
        fs.dev.inject_bit_rot(bid)
        post_corrupt_bytes = fs.dev.read_block(bid)
        assert pre_corrupt_bytes != post_corrupt_bytes, \
            "inject_bit_rot must physically change block bytes"
        assert _sha256(post_corrupt_bytes) != inode.leaf_hashes[0], \
            "Corrupt block's hash must differ from the trusted leaf hash"

        # --- Step 3: remove both recovery sources ---
        # Tier-1: recovery cache
        fs.recovery_cache.pop(bid, None)
        assert bid not in fs.recovery_cache, "cache must be cleared"

        # Tier-2: snapshot extent store (no snapshots exist at all)
        assert not fs.snapshots, "no snapshots should exist"
        assert not fs.snapshot_extent_store, "extent store must be empty"

        # --- Step 4: attempt to read —must raise, not return corrupt data ---
        raised = False
        corrupt_bytes_returned = False
        try:
            result = fs.read_file("target.dat")
            # If we reach here, bytes were returned — check if they are corrupt
            if _sha256(result) != original_sha256:
                corrupt_bytes_returned = True  # BUG: silently returned corrupt data
        except IntegrityError as e:
            raised = True
            assert "EIO" in str(e), f"Error message must contain 'EIO', got: {e!r}"
            assert "target.dat" in str(e), f"Error message must name the file, got: {e!r}"
        except IOError as e:
            raised = True   # also acceptable: IntegrityError IS an IOError

        assert not corrupt_bytes_returned, (
            "CRITICAL BUG: read_file returned corrupt bytes silently instead of raising!"
        )
        assert raised, (
            "read_file must raise IntegrityError (EIO) when both tiers fail — "
            "it must NEVER silently return corrupted data."
        )

    # ------------------------------------------------------------------
    # Scenario B — Tier-1 (cache) available → read succeeds with original bytes
    # ------------------------------------------------------------------

    def test_step_by_step_tier1_available_restores_original_bytes(self, tmp_path):
        """
        Same 4-step setup, but recovery cache is LEFT INTACT.
        read_file must silently self-heal and return the original bytes.
        SHA-256 of the returned data must match the original hash.
        """
        fs = _make_fs(tmp_path, "tier1_restore.bin")
        payload = b"TIER1_RESTORE_PAYLOAD_" * 220

        inode, original_sha256 = self._write_and_hash(fs, "tier1.dat", payload)
        bid = inode.block_ids[0]

        # Step 2: corrupt the block
        fs.dev.inject_bit_rot(bid)
        assert _sha256(fs.dev.read_block(bid)) != inode.leaf_hashes[0]

        # Step 3: only wipe Tier-2 (no snapshots) — Tier-1 cache stays
        assert bid in fs.recovery_cache, "cache must still hold the block"

        # Step 4: read must silently heal and succeed
        result = fs.read_file("tier1.dat")
        result_sha256 = _sha256(result)

        assert result == payload, "Restored bytes must exactly match the original payload"
        assert result_sha256 == original_sha256, (
            f"SHA-256 mismatch after Tier-1 heal: "
            f"got {result_sha256[:16]}… expected {original_sha256[:16]}…"
        )

    # ------------------------------------------------------------------
    # Scenario C — Tier-2 (snapshot) available → read succeeds with original bytes
    # ------------------------------------------------------------------

    def test_step_by_step_tier2_snapshot_available_restores_original_bytes(self, tmp_path):
        """
        Same setup, cache is wiped but a snapshot with a clean extent store exists.
        read_file must silently self-heal via Tier-2 and return the original bytes.
        SHA-256 of the returned data must match the original hash.
        """
        fs = _make_fs(tmp_path, "tier2_restore.bin")
        payload = b"TIER2_SNAPSHOT_RESTORE_" * 220

        inode, original_sha256 = self._write_and_hash(fs, "tier2.dat", payload)
        bid = inode.block_ids[0]

        # Take snapshot BEFORE corruption (extent store captures clean bytes)
        fs.create_snapshot("clean_snap")
        extent = fs.snapshot_extent_store.get("clean_snap", {})
        assert bid in extent, "snapshot extent store must hold the block's clean bytes"
        assert _sha256(extent[bid]) == inode.leaf_hashes[0], \
            "extent store bytes must hash to the trusted leaf hash"

        # Remove Tier-1
        fs.recovery_cache.pop(bid, None)
        assert bid not in fs.recovery_cache

        # Corrupt the physical block
        fs.dev.inject_bit_rot(bid)
        assert _sha256(fs.dev.read_block(bid)) != inode.leaf_hashes[0]

        # Step 4: read must silently heal via Tier-2 and succeed
        result = fs.read_file("tier2.dat")
        result_sha256 = _sha256(result)

        assert result == payload, "Restored bytes must exactly match the original payload"
        assert result_sha256 == original_sha256, (
            f"SHA-256 mismatch after Tier-2 heal: "
            f"got {result_sha256[:16]}… expected {original_sha256[:16]}…"
        )

    # ------------------------------------------------------------------
    # Scenario D — REST API reports failure when both tiers are absent
    # ------------------------------------------------------------------

    def test_api_reports_500_not_200_with_corrupt_bytes(self, tmp_path):
        """
        Step-by-step scenario via the REST API.
        When both tiers fail the server must return HTTP 500 — not HTTP 200
        with the corrupt payload silently embedded in the JSON response.
        """
        from fastapi.testclient import TestClient
        import aerofs.app as aerofs_app
        from aerofs.app import app

        disk = str(tmp_path / "api_canonical.bin")
        aerofs_app.reset_app_filesystem(disk_path=disk)
        aerofs_app.fs.format()

        payload = b"API_CANONICAL_" * 300
        inode, original_sha256 = self._write_and_hash(
            aerofs_app.fs, "api_canonical.dat", payload
        )
        bid = inode.block_ids[0]

        # Remove both tiers
        aerofs_app.fs.recovery_cache.pop(bid, None)
        # No snapshots exist after format + write

        # Corrupt
        aerofs_app.fs.dev.inject_bit_rot(bid)

        client = TestClient(app, raise_server_exceptions=False)
        response = client.get("/api/files/read/api_canonical.dat")

        assert response.status_code == 500, (
            f"Expected HTTP 500 (EIO), not {response.status_code}. "
            f"A 200 here would mean corrupted bytes reached the client. "
            f"Response body: {response.text!r}"
        )
        # Must not return the original or the corrupt payload as 200 JSON
        assert response.status_code != 200, "HTTP 200 with corrupt data is a critical bug"

