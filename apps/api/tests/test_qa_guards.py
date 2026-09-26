import pytest

from valt_api.qa_agent.guards import Guards
from valt_api.qa_agent.scenarios import SCENARIOS, TEST_EMAIL, TEST_PASSWORD, get_scenario
from valt_api.services.ai.types import ActionCall

FAKE_KEY = "AIzaSyD-this-is-not-a-real-key-000000"


@pytest.fixture
def guards() -> Guards:
    return Guards(["localhost:8001", "127.0.0.1:8001"], max_steps=15, forbidden_literals=[FAKE_KEY])


def call(name: str, **args: object) -> ActionCall:
    return ActionCall(id="1", name=name, args=dict(args))


@pytest.mark.parametrize(
    ("url", "allowed"),
    [
        ("http://localhost:8001/", True),
        ("http://LOCALHOST:8001/signup?x=1", True),
        ("http://127.0.0.1:8001/app.js", True),
        ("http://localhost:8002/", False),
        ("http://localhost/", False),
        ("https://localhost:8001/", True),
        ("http://evil.example/", False),
        ("file:///C:/Windows/win.ini", False),
        ("javascript:alert(1)", False),
        ("not a url", False),
    ],
)
def test_host_allowed(guards: Guards, url: str, allowed: bool) -> None:
    assert guards.host_allowed(url) is allowed


def test_navigate_off_allowlist_is_blocked(guards: Guards) -> None:
    assert guards.check_action(call("navigate", url="http://evil.example")).decision == "block"
    assert guards.check_action(call("navigate", url="http://localhost:8001/")).decision == "allow"


@pytest.mark.parametrize(
    "text",
    [
        "AKIAABCDEFGHIJKLMNOP",
        "sk-abcdefghijklmnopqrstuvwxyz",
        "ghp_abcdefghijklmnopqrstuvwxyz0123",
        "AIzaSyA1234567890abcdefghijklmnopqrstu",
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123",
        "-----BEGIN RSA PRIVATE KEY-----",
        f"prefix {FAKE_KEY}",
    ],
)
def test_secret_typing_stops_the_run(guards: Guards, text: str) -> None:
    assert guards.check_action(call("type", text=text)).decision == "stop"
    assert guards.check_action(call("type_text_at", x=1, y=1, text=text)).decision == "stop"


def test_test_data_is_not_flagged(guards: Guards) -> None:
    for text in (TEST_EMAIL, TEST_PASSWORD, ""):
        assert guards.check_action(call("type", text=text)).decision == "allow"


def test_long_typing_is_blocked(guards: Guards) -> None:
    assert guards.check_action(call("type", text="a" * 501)).decision == "block"


def test_other_actions_allowed(guards: Guards) -> None:
    assert guards.check_action(call("click", x=500, y=500)).decision == "allow"


def test_step_cap(guards: Guards) -> None:
    assert not guards.step_limit_reached(14)
    assert guards.step_limit_reached(15)


def test_needs_confirmation() -> None:
    assert Guards.needs_confirmation({"decision": "require_confirmation", "explanation": "x"})
    assert not Guards.needs_confirmation({"decision": "regular"})
    assert not Guards.needs_confirmation(None)


def test_scenarios_registry() -> None:
    assert set(SCENARIOS) == {"signup_empty_password", "signup_happy_path"}
    assert get_scenario("signup_empty_password").start_url == "http://localhost:8001/"
