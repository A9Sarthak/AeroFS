"""
AeroFS Main Entry Point
Boots the AeroFS virtual storage engine, launches the web dashboard server,
and opens the interactive console in the default browser.
"""

import os
import sys
import argparse
import webbrowser
import threading
import time
import uvicorn

# Ensure aerofs package is discoverable
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def open_browser_delayed(url: str, delay: float = 1.2):
    """Opens browser after server has started listening."""
    time.sleep(delay)
    print(f"\n[+] Opening AeroFS Dashboard: {url}")
    webbrowser.open(url)


def main():
    parser = argparse.ArgumentParser(description="AeroFS: Advanced OS Storage Subsystem")
    parser.add_argument("--host", default="127.0.0.1", help="Server host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000, help="Server port (default: 8000)")
    parser.add_argument("--no-browser", action="store_true", help="Do not automatically open browser")
    parser.add_argument("--test", action="store_true", help="Run automated test suite and exit")
    parser.add_argument("--benchmark", action="store_true", help="Run performance benchmarks and exit")
    parser.add_argument("--cli", action="store_true", help="Launch interactive Unix-like CLI shell (connects to live server if running)")
    parser.add_argument("--demo", action="store_true", help="Run automated step-by-step evaluation walkthrough")
    parser.add_argument("--live", action="store_true", help="Launch live unified mode: runs Web Server in background and interactive CLI in terminal with live synchronization")

    args = parser.parse_args()
    url = f"http://{args.host}:{args.port}"

    if args.test:
        print("[*] Running AeroFS Automated Test Suite...")
        import pytest
        sys.exit(pytest.main(["tests", "-v"]))

    if args.benchmark:
        print("[*] Running AeroFS Benchmark Suite...")
        from aerofs.benchmark import run_benchmarks
        run_benchmarks()
        sys.exit(0)

    if args.live:
        print("=" * 72)
        print("      AeroFS: ADVANCED OS STORAGE & CoW DEDUPLICATION SUBSYSTEM")
        print("                     ⚡ LIVE UNIFIED DUAL-MODE ⚡")
        print("=" * 72)
        print(f"  • Starting Web Telemetry Engine on {url}...")
        
        server_config = uvicorn.Config("aerofs.app:app", host=args.host, port=args.port, log_level="warning")
        server = uvicorn.Server(server_config)
        server_thread = threading.Thread(target=server.run, daemon=True)
        server_thread.start()

        # Wait for server to bind
        from aerofs.client import check_server_available
        t0 = time.time()
        while time.time() - t0 < 6.0:
            if check_server_available(url):
                break
            time.sleep(0.15)

        if not args.no_browser:
            threading.Thread(target=open_browser_delayed, args=(url, 0.5), daemon=True).start()

        from aerofs.cli import run_interactive_cli
        try:
            run_interactive_cli(server_url=url)
        finally:
            server.should_exit = True
            time.sleep(0.2)
        sys.exit(0)

    if args.cli:
        from aerofs.cli import run_interactive_cli
        run_interactive_cli(server_url=url)
        sys.exit(0)

    if args.demo:
        from aerofs.cli import run_automated_demo
        run_automated_demo(server_url=url)
        sys.exit(0)

    print("=" * 72)
    print("      AeroFS: ADVANCED OS STORAGE & CoW DEDUPLICATION SUBSYSTEM")
    print("=" * 72)
    print(f"  • Course Module:     BITE303L Modules 6 & 7 (Storage Management & FS)")
    print(f"  • Block Architecture: 4 KB Physical Blocks (Content-Addressable)")
    print(f"  • Integrity Engine:  Hierarchical Merkle Trees (Bit-Rot Detection)")
    print(f"  • Snapshot Model:    O(1) Instant Copy-on-Write Pointers")
    print(f"  • Web Dashboard:     {url}")
    print("=" * 72)

    if not args.no_browser:
        threading.Thread(target=open_browser_delayed, args=(url,), daemon=True).start()

    from aerofs.app import app
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
