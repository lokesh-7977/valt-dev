"""Every safety check the QA agent applies. Pure functions, no I/O.

Layers (the network allowlist in browser.py is the hard boundary; these are the action checks):
- navigate off the allowlist  -> block: the model gets an error result and the run continues
- secret-like typing          -> stop: the run ends with status "blocked"
- over-long typing            -> block
- model safety_decision "require_confirmation" -> interrupt: the run ends, never auto-approved
- step cap                    -> the run ends "inconclusive"
"""

import re
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any, Literal
from urllib.parse import urlsplit

from valt_api.services.ai.types import ActionCall

MAX_TYPE_CHARS = 500

NAVIGATE_ACTIONS = frozenset({"navigate", "open_web_browser_at", "go_to"})
TYPE_ACTIONS = frozenset({"type", "type_text_at"})

# Things that look like credentials. The agent's own test data must never match these.
SECRET_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"AKIA[0-9A-Z]{16}"),  # AWS access key
    re.compile(r"sk-[A-Za-z0-9_-]{16,}"),  # OpenAI-style secret key
    re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}"),  # GitHub token
    re.compile(r"AIza[0-9A-Za-z_-]{30,}"),  # Google API key
    re.compile(r"eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+"),  # JWT
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
)


@dataclass(frozen=True, slots=True)
class Verdict:
    decision: Literal["allow", "block", "stop"]
    reason: str | None = None


ALLOW = Verdict("allow")


def _host_port(url: str) -> str | None:
    try:
        parts = urlsplit(url)
        if parts.scheme not in ("http", "https") or not parts.hostname:
            return None
        port = parts.port or (443 if parts.scheme == "https" else 80)
    except ValueError:
        return None
    return f"{parts.hostname.lower()}:{port}"


class Guards:
    def __init__(
        self,
        allowed_hosts: Iterable[str],
        max_steps: int,
        forbidden_literals: Iterable[str] = (),
    ) -> None:
        self.allowed_hosts = frozenset(h.lower() for h in allowed_hosts)
        self.max_steps = max_steps
        # e.g. the Gemini key: never let the agent type it into a page.
        self._forbidden = tuple(s for s in forbidden_literals if len(s) >= 8)

    def host_allowed(self, url: str) -> bool:
        """True for http(s) URLs whose host:port is allowlisted. data:/about: are handled by the
        browser route (they never leave the process)."""
        hp = _host_port(url)
        return hp is not None and hp in self.allowed_hosts

    def check_action(self, call: ActionCall) -> Verdict:
        if call.name in NAVIGATE_ACTIONS:
            url = str(call.args.get("url", ""))
            if not self.host_allowed(url):
                return Verdict("block", "navigation outside the app under test is not allowed")
        if call.name in TYPE_ACTIONS:
            text = str(call.args.get("text", ""))
            if self.looks_secret(text):
                return Verdict("stop", "the agent tried to type something that looks like a secret")
            if len(text) > MAX_TYPE_CHARS:
                return Verdict("block", f"typing is limited to {MAX_TYPE_CHARS} characters")
        return ALLOW

    def looks_secret(self, text: str) -> bool:
        if any(lit in text for lit in self._forbidden):
            return True
        return any(p.search(text) for p in SECRET_PATTERNS)

    @staticmethod
    def needs_confirmation(safety: dict[str, Any] | None) -> bool:
        return safety is not None and safety.get("decision") == "require_confirmation"

    def step_limit_reached(self, steps: int) -> bool:
        return steps >= self.max_steps
