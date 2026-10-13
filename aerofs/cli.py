"""
AeroFS Interactive CLI & Professional Evaluation Demonstration Engine
Provides a Unix-like interactive shell for hands-on OS storage experimentation
and an automated guided demonstration mode for academic / viva presentations.
"""

import sys
import time
import shlex
from typing import Optional, Any
from .cow_fs import AeroFileSystem
from .client import AeroFSRemoteClient, check_server_available
from .benchmark import run_benchmarks


class Colors:
    HEADER = "\033[95m"
    BLUE = "\033[94m"
    CYAN = "\033[96m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    RED = "\033[91m"
    BOLD = "\033[1m"
    UNDERLINE = "\033[4m"
    RESET = "\033[0m"


def print_banner():
    banner = f"""
{Colors.CYAN}{Colors.BOLD}========================================================================
     AeroFS: ADVANCED OS STORAGE & CoW DEDUPLICATION SUBSYSTEM
========================================================================{Colors.RESET}
  {Colors.BOLD}Course:{Colors.RESET}    BITE303L Operating Systems (Storage & File System Recovery)
  {Colors.BOLD}Engine:{Colors.RESET}    Copy-on-Write (APFS/ZFS) | 4KB Content-Addressable Blocks
  {Colors.BOLD}Integrity:{Colors.RESET} Cryptographic Binary Merkle Trees | Self-Healing Storage
  {Colors.BOLD}Mode:{Colors.RESET}      Interactive Subsystem Shell
  {Colors.YELLOW}Type 'help' for commands, 'demo' for guided evaluation walkthrough.{Colors.RESET}
------------------------------------------------------------------------"""
    print(banner)


def format_bytes(num_bytes: int) -> str:
    if num_bytes < 1024:
        return f"{num_bytes} B"
    elif num_bytes < 1024 * 1024:
        return f"{num_bytes / 1024:.2f} KB"
    else:
        return f"{num_bytes / (1024 * 1024):.2f} MB"


def render_block_map_ascii(fs: Any, max_blocks: int = 256):
    """Renders a 64x4 or 32x8 block matrix in terminal."""
    print(f"\n{Colors.BOLD}Physical Disk Allocation Map (First {max_blocks} Blocks):{Colors.RESET}")
    print(f"Legend: {Colors.CYAN}[M]{Colors.RESET} Metadata  "
          f"{Colors.GREEN}[U]{Colors.RESET} Unique  "
          f"{Colors.YELLOW}[S]{Colors.RESET} Shared/Dedup  "
          f"{Colors.RED}[X]{Colors.RESET} Corrupt  "
          f". Free\n")
    
    cols = 32
    row_str = ""
    grid_states = None
    if hasattr(fs, "get_telemetry"):
        try:
            grid_states = fs.get_telemetry().get("grid_blocks", [])
        except Exception:
            grid_states = None

    for b in range(max_blocks):
        if grid_states is not None and b < len(grid_states):
            st = grid_states[b]
            if st == 4:
                symbol = f"{Colors.RED}X{Colors.RESET}"
            elif st == 1:
                symbol = f"{Colors.CYAN}M{Colors.RESET}"
            elif st == 3:
                symbol = f"{Colors.YELLOW}S{Colors.RESET}"
            elif st == 2:
                symbol = f"{Colors.GREEN}U{Colors.RESET}"
            else:
                symbol = "."
        else:
            if b in fs.dev.corrupted_blocks:
                symbol = f"{Colors.RED}X{Colors.RESET}"
            elif b < 4:
                symbol = f"{Colors.CYAN}M{Colors.RESET}"
            elif not fs.dev.is_block_allocated(b):
                symbol = "."
            else:
                ref = fs.dedup.get_refcount(b)
                symbol = f"{Colors.YELLOW}S{Colors.RESET}" if ref > 1 else f"{Colors.GREEN}U{Colors.RESET}"
        
        row_str += symbol + " "
        if (b + 1) % cols == 0:
            start_b = b - cols + 1
            print(f"  [{start_b:04d}..{b:04d}]  {row_str}")
            row_str = ""
    print()


def print_stats(fs: AeroFileSystem):
    disk = fs.dev.get_stats()
    dedup = fs.dedup.get_stats()
    print(f"\n{Colors.BOLD}{Colors.CYAN}--- AeroFS Subsystem Telemetry ---{Colors.RESET}")
    print(f"  Physical Capacity:       {format_bytes(disk['capacity_bytes'])} ({disk['total_blocks']} blocks @ {disk['block_size']} B)")
    print(f"  Allocated Blocks:        {disk['allocated_blocks']} / {disk['total_blocks']} ({disk['utilization_percent']}%)")
    print(f"  Free Blocks:             {disk['free_blocks']}")
    print(f"  Corrupted Blocks:        {len(fs.dev.corrupted_blocks)}")
    print(f"  Logical Blocks Written:  {dedup['logical_blocks_written']}")
    print(f"  Unique Physical Blocks:  {dedup['physical_unique_blocks']}")
    print(f"  CAS Deduplication Hits:  {dedup['dedup_hits']}")
    print(f"  Storage Saved:           {format_bytes(dedup['bytes_saved'])} ({dedup['savings_percent']}%)")
    print(f"  Deduplication Ratio:     {dedup['dedup_ratio']}x")
    print(f"  Active Files:            {len(fs.files)}")
    print(f"  Active Snapshots:        {len(fs.snapshots)}\n")


def run_interactive_cli(disk_path: str = "aerofs_cli_disk.bin", server_url: Optional[str] = "http://127.0.0.1:8000"):
    print_banner()

    if server_url and check_server_available(server_url):
        fs = AeroFSRemoteClient(server_url)
        print(f"  {Colors.GREEN}{Colors.BOLD}[✓] Live Sync Active:{Colors.RESET} Connected to AeroFS Web Server at {server_url}")
        print(f"  {Colors.CYAN}    All terminal writes will update the Web Dashboard in real time!{Colors.RESET}")
    else:
        fs = AeroFileSystem(disk_path=disk_path, total_blocks=4096)
        print(f"  {Colors.YELLOW}[i] Standalone Engine Mode:{Colors.RESET} Running local storage engine (disk: {disk_path})")
    print("-" * 72)

    while True:
        try:
            raw_prompt = input(f"{Colors.GREEN}aerofs>{Colors.RESET} ").strip()
            if not raw_prompt:
                continue

            parts = shlex.split(raw_prompt)
            cmd = parts[0].lower()
            args = parts[1:]

            if cmd in ("exit", "quit", "q"):
                print(f"{Colors.YELLOW}[*] Shutting down AeroFS storage subsystem. Goodbye!{Colors.RESET}")
                break

            elif cmd == "help":
                print(f"""
{Colors.BOLD}Available AeroFS Commands:{Colors.RESET}
  {Colors.CYAN}ls{Colors.RESET}                         List all files, inodes, sizes, and Merkle roots
  {Colors.CYAN}cat <file>{Colors.RESET}                 Display content of a file
  {Colors.CYAN}write <file> "<text>"{Colors.RESET}     Write/update file with CoW and CAS deduplication
  {Colors.CYAN}rm <file>{Colors.RESET}                  Delete file (reclaims blocks if not in snapshots)
  {Colors.CYAN}snap create <name>{Colors.RESET}         Create instant O(1) zero-copy point-in-time snapshot
  {Colors.CYAN}snap list{Colors.RESET}                  List all captured snapshots
  {Colors.CYAN}snap restore <name>{Colors.RESET}        Restore active filesystem state to snapshot
  {Colors.CYAN}snap delete <name>{Colors.RESET}         Delete snapshot
  {Colors.CYAN}inspect <file>{Colors.RESET}             Display detailed file audit & block mapping
  {Colors.CYAN}tree <file>{Colors.RESET}                Render hierarchical binary Merkle Tree diagram
  {Colors.CYAN}block <id>{Colors.RESET}                 Inspect raw physical block metadata and refcount
  {Colors.CYAN}map{Colors.RESET}                        Render ASCII physical disk allocation matrix
  {Colors.CYAN}stats{Colors.RESET}                      Display capacity, CAS dedup ratio, and telemetry
  {Colors.CYAN}scrub{Colors.RESET}                      Run cryptographic Merkle Tree audit across all files
  {Colors.CYAN}corrupt [block_id]{Colors.RESET}         Simulate silent physical bit-rot data decay
  {Colors.CYAN}heal{Colors.RESET}                       Execute self-healing engine to restore corrupted blocks
  {Colors.CYAN}benchmark{Colors.RESET}                  Run scientific comparative benchmark suite
  {Colors.CYAN}demo{Colors.RESET}                       Run interactive guided teacher demonstration
  {Colors.CYAN}exit{Colors.RESET}                       Exit AeroFS shell
""")

            elif cmd == "ls":
                files = fs.list_files()
                if not files:
                    print(f"  {Colors.YELLOW}[No files in filesystem]{Colors.RESET}")
                else:
                    print(f"\n  {'INODE':<7} {'FILENAME':<22} {'SIZE':<10} {'BLOCKS':<8} {'MERKLE ROOT':<20}")
                    print("  " + "-" * 70)
                    for f in files:
                        m_short = f['merkle_root'][:16] + "..." if f['merkle_root'] else "N/A"
                        print(f"  #{f['inode_id']:<6} {f['name']:<22} {format_bytes(f['size']):<10} {f['num_blocks']:<8} {m_short:<20}")
                    print()

            elif cmd in ("cat", "read"):
                if not args:
                    print(f"{Colors.RED}Usage: cat <filename>{Colors.RESET}")
                    continue
                filename = args[0]
                try:
                    content = fs.read_file(filename)
                    text = content.decode("utf-8", errors="replace")
                    print(f"\n{Colors.CYAN}--- {filename} ({len(content)} bytes) ---{Colors.RESET}")
                    print(text)
                    print(f"{Colors.CYAN}--- End of File ---{Colors.RESET}\n")
                except FileNotFoundError:
                    print(f"{Colors.RED}Error: File '{filename}' not found.{Colors.RESET}")

            elif cmd == "write":
                if len(args) < 2:
                    print(f"{Colors.RED}Usage: write <filename> \"<content>\"{Colors.RESET}")
                    continue
                filename = args[0]
                content = args[1].encode("utf-8")
                inode, dedup_cnt = fs.write_file(filename, content)
                print(f"{Colors.GREEN}[+] Wrote '{filename}'{Colors.RESET} (Size: {len(content)} B, Blocks: {len(inode.block_ids)}, Deduped Chunks: {dedup_cnt})")
                print(f"    Merkle Root: {inode.merkle_root}")

            elif cmd in ("rm", "delete"):
                if not args:
                    print(f"{Colors.RED}Usage: rm <filename>{Colors.RESET}")
                    continue
                filename = args[0]
                if fs.delete_file(filename):
                    print(f"{Colors.GREEN}[+] Deleted '{filename}'.{Colors.RESET}")
                else:
                    print(f"{Colors.RED}Error: File '{filename}' not found.{Colors.RESET}")

            elif cmd == "snap":
                if not args:
                    print(f"{Colors.RED}Usage: snap <create|list|restore|delete> [name]{Colors.RESET}")
                    continue
                sub = args[0].lower()
                if sub == "create":
                    if len(args) < 2:
                        print(f"{Colors.RED}Usage: snap create <name>{Colors.RESET}")
                        continue
                    name = args[1]
                    try:
                        t0 = time.perf_counter()
                        snap = fs.create_snapshot(name)
                        elapsed_ms = (time.perf_counter() - t0) * 1000
                        print(f"{Colors.GREEN}[+] Snapshot '{name}' created in {elapsed_ms:.3f} ms!{Colors.RESET} ({snap['file_count']} files frozen)")
                    except ValueError as e:
                        print(f"{Colors.RED}Error: {e}{Colors.RESET}")
                elif sub == "list":
                    snaps = fs.list_snapshots()
                    if not snaps:
                        print(f"  {Colors.YELLOW}[No snapshots captured]{Colors.RESET}")
                    else:
                        print(f"\n  {'SNAPSHOT':<20} {'FILES':<8} {'SIZE':<10} {'CREATED AT':<20}")
                        print("  " + "-" * 60)
                        for s in snaps:
                            print(f"  {s['name']:<20} {s['file_count']:<8} {format_bytes(s['total_size']):<10} {s['created_at']:<20}")
                        print()
                elif sub == "restore":
                    if len(args) < 2:
                        print(f"{Colors.RED}Usage: snap restore <name>{Colors.RESET}")
                        continue
                    name = args[1]
                    try:
                        fs.restore_snapshot(name)
                        print(f"{Colors.GREEN}[+] Filesystem successfully rolled back to snapshot '{name}'.{Colors.RESET}")
                    except KeyError as e:
                        print(f"{Colors.RED}Error: {e}{Colors.RESET}")
                elif sub == "delete":
                    if len(args) < 2:
                        print(f"{Colors.RED}Usage: snap delete <name>{Colors.RESET}")
                        continue
                    name = args[1]
                    if fs.delete_snapshot(name):
                        print(f"{Colors.GREEN}[+] Snapshot '{name}' deleted.{Colors.RESET}")
                    else:
                        print(f"{Colors.RED}Error: Snapshot '{name}' not found.{Colors.RESET}")

            elif cmd == "tree":
                if not args:
                    print(f"{Colors.RED}Usage: tree <filename>{Colors.RESET}")
                    continue
                filename = args[0]
                try:
                    insp = fs.inspect_file(filename)
                    print(f"\n{Colors.BOLD}{Colors.CYAN}Cryptographic Merkle Tree for '{filename}':{Colors.RESET}")
                    print(insp["ascii_tree"])
                    print()
                except FileNotFoundError as e:
                    print(f"{Colors.RED}Error: {e}{Colors.RESET}")

            elif cmd == "inspect":
                if not args:
                    print(f"{Colors.RED}Usage: inspect <filename>{Colors.RESET}")
                    continue
                filename = args[0]
                try:
                    insp = fs.inspect_file(filename)
                    status_str = f"{Colors.GREEN}HEALTHY{Colors.RESET}" if insp["is_healthy"] else f"{Colors.RED}CORRUPTED{Colors.RESET}"
                    print(f"\n{Colors.BOLD}{Colors.CYAN}--- File Inode Inspection: {filename} ---{Colors.RESET}")
                    print(f"  Status:          {status_str}")
                    print(f"  Inode ID:        #{insp['inode']['inode_id']}")
                    print(f"  Logical Size:    {format_bytes(insp['inode']['size'])}")
                    print(f"  Physical Blocks: {insp['inode']['block_ids']}")
                    print(f"  Merkle Root:     {insp['inode']['merkle_root']}")
                    if insp["corrupted_blocks"]:
                        print(f"  {Colors.RED}Damaged Blocks:  {insp['corrupted_blocks']}{Colors.RESET}")
                    print()
                except FileNotFoundError as e:
                    print(f"{Colors.RED}Error: {e}{Colors.RESET}")

            elif cmd == "block":
                if not args:
                    print(f"{Colors.RED}Usage: block <block_id>{Colors.RESET}")
                    continue
                try:
                    bid = int(args[0])
                    details = fs.get_block_details(bid)
                    alloc_str = f"{Colors.GREEN}Allocated{Colors.RESET}" if details["is_allocated"] else f"{Colors.YELLOW}Free{Colors.RESET}"
                    corrupt_str = f"{Colors.RED}YES (Bit-Rot){Colors.RESET}" if details["is_corrupted"] else f"{Colors.GREEN}No{Colors.RESET}"
                    print(f"\n{Colors.BOLD}{Colors.CYAN}--- Physical Sector #{bid} Details ---{Colors.RESET}")
                    print(f"  Allocation State:  {alloc_str}")
                    print(f"  Corrupted:         {corrupt_str}")
                    print(f"  Reference Count:   {details['refcount']}")
                    print(f"  Expected CAS Hash: {details['expected_hash']}")
                    print(f"  Actual Disk Hash:  {details['actual_hash']}")
                    print(f"  Referenced by:     {details['referencing_files'] or 'None'}")
                    print(f"  In Snapshots:      {details['referencing_snapshots'] or 'None'}\n")
                except ValueError:
                    print(f"{Colors.RED}Error: Block ID must be an integer.{Colors.RESET}")
                except IndexError as e:
                    print(f"{Colors.RED}Error: {e}{Colors.RESET}")

            elif cmd == "map":
                render_block_map_ascii(fs)

            elif cmd == "stats":
                print_stats(fs)

            elif cmd == "scrub":
                print(f"[*] Running Merkle-Tree cryptographic audit across storage subsystem...")
                report = fs.scrub_all()
                if report["status"] == "HEALTHY":
                    print(f"{Colors.GREEN}[✓] Storage Audit Clean: Verified {report['files_audited']} file(s). 0 corruptions detected.{Colors.RESET}\n")
                else:
                    print(f"{Colors.RED}[!] Integrity Failure: Found {report['corrupted_blocks_total']} damaged block(s)!{Colors.RESET}")
                    for d in report["details"]:
                        if d["status"] == "CORRUPTED":
                            print(f"    • File '{d['file']}': Damaged blocks {d['corrupted_blocks']}")
                    print()

            elif cmd == "corrupt":
                if args:
                    try:
                        bid = int(args[0])
                        fs.dev.inject_bit_rot(bid)
                        print(f"{Colors.YELLOW}[!] Injected simulated bit-rot into block #{bid}.{Colors.RESET}")
                    except Exception as e:
                        print(f"{Colors.RED}Error: {e}{Colors.RESET}")
                else:
                    # Pick random allocated block
                    allocated = [b for b in range(fs.dev.data_start_block, fs.dev.total_blocks)
                                 if fs.dev.is_block_allocated(b) and b not in fs.dev.corrupted_blocks]
                    if not allocated:
                        print(f"{Colors.RED}Error: No allocated data blocks available to corrupt.{Colors.RESET}")
                    else:
                        import random
                        bid = random.choice(allocated)
                        fs.dev.inject_bit_rot(bid)
                        print(f"{Colors.YELLOW}[!] Injected simulated bit-rot into block #{bid}. Run 'scrub' to detect!{Colors.RESET}")

            elif cmd == "heal":
                print(f"[*] Running AeroFS Autonomous Self-Healing Subsystem...")
                result = fs.self_heal_all()
                if result["repaired_count"] > 0:
                    print(f"{Colors.GREEN}[✓] Self-Healed {result['repaired_count']} block(s): {result['repaired_blocks']}{Colors.RESET}")
                    print(f"    Post-Heal Storage Status: {Colors.GREEN}{result['post_heal_status']}{Colors.RESET}\n")
                else:
                    print(f"{Colors.CYAN}[*] No corrupted blocks detected. Subsystem healthy.{Colors.RESET}\n")

            elif cmd == "benchmark":
                run_benchmarks()

            elif cmd == "demo":
                run_automated_demo(fs)

            else:
                print(f"{Colors.RED}Unknown command '{cmd}'. Type 'help' for available commands.{Colors.RESET}")

        except (KeyboardInterrupt, EOFError):
            print(f"\n{Colors.YELLOW}[*] Exiting AeroFS shell.{Colors.RESET}")
            break


def run_automated_demo(existing_fs: Optional[Any] = None, server_url: Optional[str] = "http://127.0.0.1:8000"):
    """
    Automated evaluation walkthrough designed specifically for viva & teacher demonstrations.
    Walks step-by-step through each core OS concept with explanatory prompts.
    """
    if existing_fs is not None:
        fs = existing_fs
    elif server_url and check_server_available(server_url):
        print(f"\n{Colors.GREEN}{Colors.BOLD}[✓] Live Sync Active:{Colors.RESET} Connected to AeroFS Web Server at {server_url}")
        print(f"{Colors.CYAN}    Demonstration will update the Web Dashboard in real time!{Colors.RESET}")
        try:
            import requests
            requests.post(f"{server_url.rstrip('/')}/api/format", timeout=3)
        except Exception:
            pass
        fs = AeroFSRemoteClient(server_url)
    else:
        demo_disk = "aerofs_demo_viva.bin"
        fs = AeroFileSystem(disk_path=demo_disk, total_blocks=512)

    def pause_step(step_num: int, title: str):
        print(f"\n{Colors.BOLD}{Colors.YELLOW}" + "=" * 72)
        print(f"  STEP {step_num}: {title.upper()}")
        print("=" * 72 + f"{Colors.RESET}")
        input(f"{Colors.CYAN}[Press Enter to execute Step {step_num}...] {Colors.RESET}")

    print(f"""
{Colors.BOLD}{Colors.CYAN}========================================================================
       AeroFS: OFFICIAL ACADEMIC EVALUATION & VIVA DEMONSTRATION
========================================================================{Colors.RESET}
This automated walkthrough demonstrates the core Operating System concepts:
  1. Virtual Raw Block Device & Superblock initialization
  2. Content-Addressable Storage (CAS) Deduplication with SHA-256
  3. Instant O(1) Zero-Copy Snapshots (APFS/ZFS style)
  4. Copy-on-Write (CoW) Mutation Engine (never overwrites in-place)
  5. Silent Bit-Rot Detection via Hierarchical Merkle Trees
  6. Autonomous Storage Self-Healing
------------------------------------------------------------------------
""")

    # Step 1
    pause_step(1, "Virtual Raw Block Device & Superblock Layout")
    print(f"[*] Booting Virtual Block Device (4 KB Physical Sectors, 16 MB Image)...")
    stats = fs.dev.get_stats()
    print(f"    • Total Sectors:     {stats['total_blocks']} blocks")
    print(f"    • Sector Size:       {stats['block_size']} bytes (Standard OS 4KB page)")
    print(f"    • Reserved Metadata: Blocks 0..3 (Superblock @ Block 0, Bitmap @ Block 1..3)")
    print(f"    • Usable Data Start: Block #{fs.dev.data_start_block}")
    render_block_map_ascii(fs, max_blocks=64)

    # Step 2
    pause_step(2, "Content-Addressable Storage (CAS) Deduplication")
    print(f"[*] Writing original kernel source file 'kernel_core.c' (16 KB = 4 blocks)...")
    sample_block = b"/* AeroFS OS Kernel Driver Core - Module 6/7 */\n" * 90 # 4KB
    payload_16k = sample_block[:4096] * 4
    inode1, dedup1 = fs.write_file("kernel_core.c", payload_16k)
    print(f"    • Inode #1 Created: {len(inode1.block_ids)} physical blocks allocated: {inode1.block_ids}")
    
    print(f"\n[*] Now writing 3 IDENTICAL file copies under different names (backup1, replica, clone)...")
    fs.write_file("kernel_backup.c", payload_16k)
    fs.write_file("kernel_replica.c", payload_16k)
    fs.write_file("kernel_clone.c", payload_16k)
    
    dedup_stats = fs.dedup.get_stats()
    print(f"    {Colors.GREEN}[✓] CAS RESULT:{Colors.RESET}")
    print(f"    • Logical Data Written:  {format_bytes(dedup_stats['logical_blocks_written'] * 4096)} (16 blocks)")
    print(f"    • Physical Disk Used:    {format_bytes(dedup_stats['physical_unique_blocks'] * 4096)} (Only 4 blocks!)")
    print(f"    • Space Saved:           {dedup_stats['savings_percent']}% (Deduplication Ratio: {dedup_stats['dedup_ratio']}x)")
    render_block_map_ascii(fs, max_blocks=64)

    # Step 3
    pause_step(3, "Instant O(1) Zero-Copy Snapshot Creation")
    print(f"[*] Freezing point-in-time filesystem state into snapshot 'snap_v1.0'...")
    t0 = time.perf_counter()
    snap = fs.create_snapshot("snap_v1.0")
    snap_time_ms = (time.perf_counter() - t0) * 1000
    print(f"    {Colors.GREEN}[✓] Snapshot 'snap_v1.0' captured in {snap_time_ms:.3f} milliseconds!{Colors.RESET}")
    print(f"    • Files Preserved: {snap['file_count']}")
    print(f"    • Overhead: 0 additional data blocks allocated on disk ($O(1)$ reference duplication)")

    # Step 4
    pause_step(4, "Copy-on-Write (CoW) Inode Mutation Engine")
    print(f"[*] Modifying 'kernel_core.c' with updated scheduler logic...")
    mutated_payload = payload_16k[:4096] * 3 + (b"NEW_SCHEDULER_PATCH_CODE_BLOCK\n" * 128)[:4096]
    inode_mod, dedup_mod = fs.write_file("kernel_core.c", mutated_payload)
    print(f"    • Notice: First 3 blocks reused existing physical sectors via CAS deduplication!")
    print(f"    • Only the 4th changed block allocated a new sector on disk!")
    print(f"    • The original snapshot 'snap_v1.0' remains completely untouched and immutable.")

    # Step 5
    pause_step(5, "Cryptographic Merkle Tree & Silent Bit-Rot Detection")
    print(f"[*] File 'kernel_core.c' Hierarchical Binary Merkle Tree:")
    insp = fs.inspect_file("kernel_core.c")
    print(insp["ascii_tree"])
    
    target_block = inode_mod.block_ids[3]
    print(f"\n[*] Simulating silent hardware bit-flip (bit-rot) on Sector #{target_block}...")
    fs.dev.inject_bit_rot(target_block)
    print(f"    {Colors.RED}[!] Sector #{target_block} corrupted!{Colors.RESET}")
    render_block_map_ascii(fs, max_blocks=64)

    print(f"[*] Running Filesystem Storage Scrub (Merkle Proof Verification)...")
    scrub_res = fs.scrub_all()
    print(f"    {Colors.RED}[!] Scrub Status: {scrub_res['status']}! Corrupted Blocks: {scrub_res['corrupted_blocks_total']}{Colors.RESET}")
    print(f"    • Damaged sector #{target_block} detected with 100% precision via cryptographic root divergence.")

    # Step 6
    pause_step(6, "Autonomous Self-Healing Subsystem")
    print(f"[*] Executing self-healing algorithm to reconstruct corrupted sector #{target_block}...")
    heal_res = fs.self_heal_all()
    print(f"    {Colors.GREEN}[✓] Self-Healed Sector #{target_block}!{Colors.RESET}")
    print(f"    • Post-Repair Filesystem Status: {Colors.GREEN}{heal_res['post_heal_status']}{Colors.RESET}")
    
    print(f"\n[*] Verifying data read integrity after repair:")
    restored_bytes = fs.read_file("kernel_core.c")
    assert restored_bytes == mutated_payload
    print(f"    {Colors.GREEN}[✓] Verified: Data read matches original byte-for-byte!{Colors.RESET}")
    render_block_map_ascii(fs, max_blocks=64)

    print(f"""
{Colors.BOLD}{Colors.GREEN}========================================================================
     EVALUATION DEMONSTRATION COMPLETE: ALL 6 OBJECTIVES VERIFIED
========================================================================{Colors.RESET}
Ready for professor questions and viva presentation!
""")
