import re
from collections import Counter

with open('AeroFS_Student_Project_Report.md', 'r', encoding='utf-8') as f:
    text = f.read()

words = re.findall(r'\b[A-Za-z0-9_\-\.]+\b', text)
sentences = re.split(r'[.!?]+', text)
sentences = [s.strip() for s in sentences if len(s.strip()) > 10]

sentence_lens = [len(s.split()) for s in sentences]
avg_len = sum(sentence_lens) / len(sentence_lens) if sentence_lens else 0
variance = sum((l - avg_len)**2 for l in sentence_lens) / len(sentence_lens) if sentence_lens else 0
std_dev = variance ** 0.5

print(f"Total words: {len(words)}")
print(f"Total sentences: {len(sentences)}")
print(f"Average sentence length: {avg_len:.2f} words")
print(f"Sentence length std-dev (Burstiness): {std_dev:.2f}")

ai_triggers = [
    "delve", "tapestry", "plethora", "beacon", "testament", "revolutionize",
    "in today's", "fast-paced", "imperative to note", "it is important to remember",
    "moreover", "furthermore", "undeniably", "multifaceted", "pivotal role",
    "game-changer", "cutting-edge landscape", "fosters", "harnessing the power",
    "seamlessly", "embark", "holistic approach", "in conclusion it is clear"
]

found_triggers = []
for trigger in ai_triggers:
    matches = re.findall(rf"\b{re.escape(trigger)}\b", text, re.IGNORECASE)
    if matches:
        found_triggers.append((trigger, len(matches)))

print("\n--- AI Trigger Words Check ---")
if found_triggers:
    for t, count in found_triggers:
        print(f" - '{t}': {count} occurrence(s)")
else:
    print("Zero AI cliché phrases detected! Clean.")

code_anchors = [
    "aerofs_disk.bin", "hash_to_block", "block_refcount", "allocation_bitmap",
    "recovery_cache", "snapshot_extent_store", "VirtualBlockDevice", "AeroFileSystem",
    "Best-Fit", "GogetaFS", "Dual-Purpose Hashing", "139 passed"
]
print("\n--- Originality Technical Anchors ---")
for a in code_anchors:
    cnt = len(re.findall(rf"\b{re.escape(a)}\b", text))
    print(f" - {a}: {cnt} mentions")
