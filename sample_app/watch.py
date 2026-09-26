"""Save watcher for the demo: POST to the QA save hook whenever a sample_app file changes.

Stdlib only. Polls mtimes every 0.5 s, so it works the same on every OS and editor.
The API debounces and cancels in-flight runs, so we can post on every change.

    python sample_app/watch.py          # QA_HOOK_URL overrides the hook URL
"""

import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
HOOK_URL = os.environ.get("QA_HOOK_URL", "http://localhost:8000/api/v1/qa/save-hook")
PATTERNS = ("*.html", "*.js", "*.css")


def snapshot() -> dict[Path, float]:
    return {p: p.stat().st_mtime for pat in PATTERNS for p in ROOT.glob(pat)}


def post(path: Path) -> None:
    body = json.dumps({"path": path.name}).encode()
    req = urllib.request.Request(
        HOOK_URL, data=body, headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as res:
            print(f"saved {path.name} -> POST {HOOK_URL} {res.status}")
    except urllib.error.HTTPError as exc:
        print(f"saved {path.name} -> POST {HOOK_URL} {exc.code}")
    except OSError as exc:
        print(f"saved {path.name} -> hook unreachable ({exc})")


def main() -> None:
    print(f"watching {ROOT} -> {HOOK_URL} (Ctrl+C to stop)")
    seen = snapshot()
    while True:
        time.sleep(0.5)
        now = snapshot()
        for path, mtime in now.items():
            if seen.get(path) != mtime:
                post(path)
        seen = now


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
