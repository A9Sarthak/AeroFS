# AeroFS: Professional Viva & Evaluation Presentation Script

> **Course Code:** BITE303L — Operating Systems  
> **Topic:** Advanced OS Storage Subsystem, Copy-on-Write (CoW), CAS Deduplication & Merkle Self-Healing  
> **Real-World Case Study References:** Apple APFS, OpenZFS, and Linux EXT4  

---

## 🎙️ 1. Opening Pitch (Say this to your Professor)

> *"Good morning Professor,*
> 
> *Traditional operating system file systems like FAT32 and standard EXT2/EXT3 rely on **in-place block updates** and lack native **block-level deduplication**. In production environments, this results in three major flaws:*
> 1. *Massive storage waste (over 80% redundant blocks for system backups, virtual disk images, and cloned files),*
> 2. *Vulnerability to dirty crash states when a power cut interrupts an in-place write (torn writes), and*
> 3. *Inability to detect **silent hardware bit-rot** (magnetic/flash decay where an I/O read succeeds but data is quietly corrupted).*
>
> *To solve this, I designed and implemented **AeroFS** — a virtual operating system storage subsystem modeled after the architectures of **Apple APFS** and **ZFS**.*
> 
> *AeroFS implements four core OS storage innovations:*
> - *First, **Content-Addressable Storage (CAS) Deduplication** using SHA-256 block fingerprinting and reference counting,*
> - *Second, **Copy-on-Write (CoW) Inode extents** guaranteeing crash consistency without expensive journaling,*
> - *Third, **Instant $O(1)$ Zero-Copy Snapshots** created in sub-millisecond latency, and*
> - *Fourth, **Hierarchical Cryptographic Merkle Trees** for real-time silent bit-rot localization and autonomous self-healing.*
>
> *I have implemented this end-to-end with a raw 4KB sector Virtual Block Device, a full REST API, an interactive 1,024-block visual dashboard, an interactive Unix-like CLI shell, scientific benchmarks, and 7 automated unit test suites."*

---

## 🖥️ 2. Live Demo Script (Step-by-Step Walkthrough)

You can demonstrate AeroFS in any of these modes:
1. **⚡ Live Unified Dual-Mode (Recommended):** `python main.py --live`  
   *Runs the background server, auto-opens the browser, and keeps the terminal CLI open. Every terminal write updates the browser live in real time!*
2. **Visual Web Console Alone:** `python main.py`
3. **Interactive Terminal CLI / Guided Demo:** `python main.py --demo` or `python main.py --cli` *(Auto-connects to live web server if running!)*

### Step 1: Explain the Physical Storage Layout
- Point to the **1,024-Block Disk Map** on the web dashboard (or CLI `map`).
- **Explain to Professor:**
  - Block 0: **Superblock** (`AER0FS01` magic number, block size 4,096 bytes, total sector count).
  - Blocks 1..3: **Block Allocation Table (Bitmap)** tracking free vs. allocated sectors.
  - Blocks 4+: **Data Sectors** for file chunks.

### Step 2: Demonstrate Content-Addressable Storage (CAS) Deduplication
- Click **"Run Demo Workload"** in the Web UI (or type `write file1.bin "data"` and `write file2.bin "data"` in CLI).
- **Show the Metrics:**
  - Notice the **Deduplication Ratio** jumps (e.g., **93.75% space reduction**).
  - Notice that in the block map, multiple files point to the **same purple shared blocks** (`Ref > 1`).
- **Say to Professor:**
  - *"Notice that when identical files are written, AeroFS does not allocate duplicate physical sectors. Instead, it computes the SHA-256 hash of each 4KB chunk, detects an existing entry in our global Content-Addressable Storage index, and increments the block's reference counter in $O(1)$ time."*

### Step 3: Demonstrate Instant $O(1)$ Zero-Copy Snapshots
- Click **"Create Snapshot"** (name: `baseline_v1`).
- **Show the latency:** Created in **under 1 millisecond** (e.g., 0.36 ms).
- **Say to Professor:**
  - *"In traditional file systems, creating a backup requires an $O(N)$ recursive copy of all physical data blocks, which takes hundreds of milliseconds and doubles disk usage. In AeroFS, snapshotting takes less than 1 millisecond because it duplicates only the inode block extent pointers and increments block reference counts. No physical data blocks are copied."*

### Step 4: Demonstrate Copy-on-Write (CoW) Mutation
- Add or modify a file that was part of the snapshot.
- Point to the block map: Only the modified 4KB block is allocated as a new green sector.
- Revert using **"Restore Snapshot"**: The filesystem instantly rolls back to the exact previous state!

### Step 5: Demonstrate Merkle Tree Bit-Rot Detection & Self-Healing
- Click **"Inject Bit-Rot"**: A physical sector flips bytes and turns **RED** on the map.
- Click **"Run Merkle Scrub"**: The audit immediately flags **DEGRADED** and pinpoints the exact damaged sector!
- Click any file's **"Inspect"** button: Show the teacher the **Hierarchical Binary Merkle Tree** (Root hash $\rightarrow$ branch hashes $\rightarrow$ leaf blocks).
- Click **"Self-Heal Bit-Rot"**: The recovery engine restores the clean sector, re-verifies the Merkle proof, and turns the sector back to healthy!

---

## 🎯 3. Top 10 Tough Viva Questions & Model Answers

### Q1: How does AeroFS prevent crash corruption during sudden power failure without journaling?
> **Answer:** *"Traditional file systems like EXT3/EXT4 use write-ahead journaling because in-place overwrites can leave inodes in a half-written 'dirty' state during power cuts. AeroFS uses Copy-on-Write (CoW), inspired by ZFS and WAFL. We never overwrite blocks in-place. When a block is modified, AeroFS writes the new data to a freshly allocated sector first. Only after the physical disk write completes successfully is the inode's block pointer atomically redirected to the new sector. If power is lost mid-write, the original pointers remain 100% valid, guaranteeing zero crash corruption."*

### Q2: What is the probability of a SHA-256 hash collision causing data loss in CAS?
> **Answer:** *"The probability of a cryptographic SHA-256 collision is $1$ in $2^{256}$ (approx $10^{77}$). To put this in perspective, this is astronomically smaller than the probability of an unrecoverable read error on physical hardware (approx $10^{-14}$ for enterprise HDDs and SSDs). In operating systems like Git, ZFS, and Content-Addressable Storage systems, SHA-256 collision probability is mathematically negligible and accepted as secure."*

### Q3: What is the difference between file-level and block-level deduplication?
> **Answer:** *"File-level deduplication only detects files that are 100% identical in their entirety. If a single byte in a 1GB file changes, file-level deduplication fails and stores another 1GB. AeroFS implements block-level deduplication (fixed 4KB chunks). If a user modifies only 100 bytes in a 10MB document, 99.9% of the 4KB chunks remain identical and share physical disk blocks, storing only the single modified 4KB chunk."*

### Q4: Why use a Merkle Tree instead of just storing a single SHA-256 checksum for the whole file?
> **Answer:** *"A single file checksum tells us that corruption occurred, but it cannot localize which sector was damaged. With a binary Merkle tree of depth $O(\log N)$, AeroFS can pinpoint the exact damaged 4KB block in logarithmic time by descending down divergent branch hashes. Furthermore, during partial file writes, only the $O(\log N)$ path from the modified leaf block to the root needs to be recomputed, rather than rehashing the entire multi-gigabyte file."*

### Q5: What happens when a file is deleted if another file or snapshot shares its blocks?
> **Answer:** *"AeroFS uses Reference Counting in the deduplication engine. When a file is deleted, `release_chunk(block_id)` decrements the reference count of its blocks. If a block's reference count is greater than 1 (because another file or snapshot still references it), the physical sector is NOT returned to the free list. The sector is only zeroed and freed in the allocation bitmap when its reference count drops to exactly 0."*

### Q6: What is 'Write Amplification' in Copy-on-Write systems and how is it addressed?
> **Answer:** *"Write amplification in CoW occurs because modifying a leaf block requires updating its parent inode block and potentially root directories. In AeroFS, this is minimized by batching block extent updates and caching clean chunk proofs, ensuring that only the modified sector and its associated inode metadata are written."*

### Q7: How does AeroFS simulate raw disk I/O in Python?
> **Answer:** *"AeroFS implements `VirtualBlockDevice` backed by a binary container file (`.bin`). It operates directly on raw sector offsets using binary seek and read/write operations (`f.seek(block_id * block_size)`). It strictly enforces block boundary alignment (4096 bytes) and maintains a synchronized in-memory and on-disk allocation bitmap, simulating a real hardware disk controller."*

### Q8: How does AeroFS compare against Apple APFS and OpenZFS?
> **Answer:**
> - *Like **Apple APFS**, AeroFS implements instantaneous $O(1)$ zero-copy cloning and snapshots with block-level CoW.*
> - *Like **OpenZFS**, AeroFS implements cryptographic Merkle tree integrity verification, bit-rot detection, and storage scrubbing.*
> - *In addition, AeroFS features real-time Content-Addressable Storage (CAS) deduplication with a live 1,024-block visual telemetry matrix.*

### Q9: What is 'Silent Bit-Rot' and why can't standard OS error codes detect it?
> **Answer:** *"Silent bit-rot occurs when cosmic radiation, magnetic degradation, or flash transistor leakage flips a physical bit on the storage medium. When the OS issues a read command, the disk controller returns the corrupted bytes without throwing an I/O error because the sector itself is physically readable. Standard file systems have no checksums to know the data changed. AeroFS detects this because the cryptographic SHA-256 hash of the corrupted bytes diverges from the recorded Merkle tree root."*

### Q10: What are the space and time complexities of AeroFS core operations?
> **Answer:**
> - *Snapshot Creation: **$O(1)$ Time** (shallow inode pointer duplicate + refcount increment).*
> - *Chunk CAS Lookup: **$O(1)$ Average Time** (hash table indexing).*
> - *Merkle Tree Rebuild / Audit: **$O(N)$ Time** where $N$ is the number of blocks, with **$O(\log N)$ Tree Depth**.*
> - *Sector Allocation: **$O(1)$ to $O(N)$** via fast bitmap traversal.*

---

## 📊 4. Course Syllabus Alignment Matrix

| Syllabus Topic (BITE303L) | Course Requirement | AeroFS Implementation Component |
| :--- | :--- | :--- |
| **Module 6: Storage Management** | Block devices, allocation methods, free space management | `VirtualBlockDevice` (`disk.py`), Superblock, 4KB Allocation Bitmap |
| **Module 6: Disk Scheduling & Layout** | Sector addressing, disk capacity, block fragmentation | `get_stats()`, 1,024-Block physical matrix visualization |
| **Module 7: File System Allocation** | Inode structures, extent maps, file metadata | `FileInode` (`cow_fs.py`), block extents, reference counting |
| **Module 7: File System Recovery** | Crash recovery, data consistency, integrity protection | Copy-on-Write (CoW), Merkle Tree scrubber (`merkle.py`), Self-Healing |
| **Case Studies: APFS & ZFS** | CoW snapshots, deduplication, bit-rot scrubbing | CAS Deduplication (`dedup.py`), $O(1)$ Snapshots, Merkle Trees |
