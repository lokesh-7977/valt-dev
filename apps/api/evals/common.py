"""Shared eval helpers: serve a static directory, write timestamped results."""

import functools
import http.server
import json
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args: Any) -> None:
        pass


@contextmanager
def serve_dir(directory: Path, host: str = "127.0.0.1", port: int = 8001) -> Iterator[str]:
    """Serve `directory` over HTTP on a background thread for the duration of the block."""
    handler = functools.partial(_QuietHandler, directory=str(directory))
    server = http.server.ThreadingHTTPServer((host, port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://{host}:{port}/"
    finally:
        server.shutdown()
        server.server_close()


def write_results(out_dir: Path, name: str, payload: dict[str, Any]) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    path = out_dir / f"{name}-{stamp}.json"
    path.write_text(json.dumps(payload, indent=2))
    return path
