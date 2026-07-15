#!/usr/bin/env python3
"""Disposable two-person browser QA for Ateneum.

Requires Python's `websockets` package and Chrome/Chromium. The test starts the
already-built production bundle against a temporary SQLite database and drives
three isolated browser contexts through Chrome DevTools Protocol.
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    from websockets.sync.client import connect
except ImportError as error:  # pragma: no cover - environment preflight
    raise SystemExit("browser QA requires Python package 'websockets'") from error

ROOT = Path(__file__).resolve().parents[2]


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def wait_http(url: str, timeout: float = 25.0) -> None:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status == 200:
                    return
        except Exception as error:  # startup race
            last_error = error
        time.sleep(0.15)
    raise RuntimeError(f"server did not become ready at {url}: {last_error}")


def wait_json(url: str, timeout: float = 15.0) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                return json.loads(response.read())
        except Exception as error:
            last_error = error
        time.sleep(0.1)
    raise RuntimeError(f"Chrome debugging endpoint did not become ready: {last_error}")


class CDP:
    def __init__(self, websocket_url: str):
        self.ws = connect(websocket_url, max_size=None)
        self.next_id = 1
        self.events: list[dict[str, Any]] = []
        self.requests: list[dict[str, Any]] = []
        self.responses: list[dict[str, Any]] = []
        self.errors: list[str] = []

    def close(self) -> None:
        self.ws.close()

    def _record(self, message: dict[str, Any]) -> None:
        if "method" not in message:
            return
        self.events.append(message)
        method = message["method"]
        params = message.get("params", {})
        if method == "Network.requestWillBeSent":
            self.requests.append(params.get("request", {}))
        elif method == "Network.responseReceived":
            self.responses.append(params.get("response", {}))
        elif method == "Runtime.exceptionThrown":
            detail = params.get("exceptionDetails", {})
            self.errors.append(f"exception: {detail.get('text', 'unknown')}")
        elif method == "Log.entryAdded" and params.get("entry", {}).get("level") == "error":
            self.errors.append(f"console: {params['entry'].get('text', 'unknown')}")
        elif method == "Network.loadingFailed":
            text = params.get("errorText", "network loading failed")
            if text not in {"net::ERR_ABORTED", "net::ERR_BLOCKED_BY_CLIENT"}:
                self.errors.append(f"network: {text}")

    def call(
        self,
        method: str,
        params: dict[str, Any] | None = None,
        *,
        session_id: str | None = None,
        timeout: float = 15.0,
    ) -> dict[str, Any]:
        command_id = self.next_id
        self.next_id += 1
        command: dict[str, Any] = {"id": command_id, "method": method, "params": params or {}}
        if session_id:
            command["sessionId"] = session_id
        self.ws.send(json.dumps(command))
        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(f"CDP command timed out: {method}")
            message = json.loads(self.ws.recv(timeout=remaining))
            self._record(message)
            if message.get("id") != command_id:
                continue
            if "error" in message:
                raise RuntimeError(f"CDP {method}: {message['error']}")
            return message.get("result", {})


@dataclass
class Page:
    cdp: CDP
    session_id: str
    context_id: str
    base_url: str

    def eval(self, expression: str, *, await_promise: bool = False) -> Any:
        result = self.cdp.call(
            "Runtime.evaluate",
            {
                "expression": expression,
                "awaitPromise": await_promise,
                "returnByValue": True,
                "userGesture": True,
            },
            session_id=self.session_id,
        )
        if result.get("exceptionDetails"):
            detail = result["exceptionDetails"]
            description = detail.get("exception", {}).get("description") or detail.get("text")
            raise AssertionError(f"browser expression failed: {description}\n{expression}")
        return result.get("result", {}).get("value")

    def navigate(self, path: str) -> None:
        url = path if path.startswith("http") else self.base_url + path
        self.cdp.call("Page.navigate", {"url": url}, session_id=self.session_id)
        self.wait("document.readyState === 'complete'", timeout=20)

    def wait(self, expression: str, *, timeout: float = 12.0, message: str | None = None) -> Any:
        deadline = time.monotonic() + timeout
        last_value: Any = None
        while time.monotonic() < deadline:
            last_value = self.eval(f"Boolean({expression})")
            if last_value:
                return last_value
            time.sleep(0.1)
        raise AssertionError(message or f"browser condition timed out: {expression}; last={last_value!r}")

    def click(self, selector: str) -> None:
        encoded = json.dumps(selector)
        self.eval(
            f"""(() => {{
              const element = document.querySelector({encoded});
              if (!element) throw new Error('missing element: ' + {encoded});
              element.click();
              return true;
            }})()"""
        )

    def click_in_card(self, title: str, selector: str) -> None:
        title_json = json.dumps(title)
        selector_json = json.dumps(selector)
        self.eval(
            f"""(() => {{
              const card = [...document.querySelectorAll('.idea, .activity, .plan-card')]
                .find(node => node.textContent.includes({title_json}));
              if (!card) throw new Error('missing card: ' + {title_json});
              const element = card.querySelector({selector_json});
              if (!element) throw new Error('missing card control: ' + {selector_json});
              element.click();
              return true;
            }})()"""
        )

    def set_value(self, selector: str, value: str) -> None:
        selector_json = json.dumps(selector)
        value_json = json.dumps(value)
        self.eval(
            f"""(() => {{
              const element = document.querySelector({selector_json});
              if (!element) throw new Error('missing input: ' + {selector_json});
              element.value = {value_json};
              element.dispatchEvent(new Event('input', {{ bubbles: true }}));
              element.dispatchEvent(new Event('change', {{ bubbles: true }}));
              return true;
            }})()"""
        )

    def set_card_value(self, title: str, selector: str, value: str) -> None:
        title_json = json.dumps(title)
        selector_json = json.dumps(selector)
        value_json = json.dumps(value)
        self.eval(
            f"""(() => {{
              const card = [...document.querySelectorAll('.idea, .activity, .plan-card')]
                .find(node => node.textContent.includes({title_json}));
              if (!card) throw new Error('missing card: ' + {title_json});
              const element = card.querySelector({selector_json});
              if (!element) throw new Error('missing card input: ' + {selector_json});
              element.value = {value_json};
              element.dispatchEvent(new Event('input', {{ bubbles: true }}));
              element.dispatchEvent(new Event('change', {{ bubbles: true }}));
              return true;
            }})()"""
        )

    def login(self, username: str, password: str) -> None:
        payload = json.dumps({"username": username, "password": password})
        result = self.eval(
            f"""fetch('/api/ateneum/auth/login', {{
              method: 'POST', credentials: 'include',
              headers: {{ 'Content-Type': 'application/json' }},
              body: JSON.stringify({payload})
            }}).then(async response => ({{ status: response.status, body: await response.text() }}))""",
            await_promise=True,
        )
        if result.get("status") != 200:
            raise AssertionError(f"login failed for {username}: {result}")
        self.navigate("/ateneum/")
        self.wait(
            f"typeof currentUser !== 'undefined' && currentUser && currentUser.username === {json.dumps(username)}",
            message=f"authenticated UI did not load for {username}",
        )


def create_page(cdp: CDP, base_url: str, width: int, height: int) -> Page:
    context_id = cdp.call("Target.createBrowserContext")["browserContextId"]
    target_id = cdp.call(
        "Target.createTarget",
        {"url": "about:blank", "browserContextId": context_id},
    )["targetId"]
    session_id = cdp.call(
        "Target.attachToTarget",
        {"targetId": target_id, "flatten": True},
    )["sessionId"]
    for method in ("Page.enable", "Runtime.enable", "Network.enable", "Log.enable"):
        cdp.call(method, session_id=session_id)
    cdp.call(
        "Emulation.setDeviceMetricsOverride",
        {"width": width, "height": height, "deviceScaleFactor": 1, "mobile": width <= 500},
        session_id=session_id,
    )
    page = Page(cdp, session_id, context_id, base_url)
    page.navigate("/ateneum/")
    return page


def run_plan_client(base_url: str, token: str, *args: str) -> Any:
    configured_client = os.environ.get("ATENEUM_CLIENT_PATH")
    client = (
        Path(configured_client).expanduser().resolve()
        if configured_client
        else Path.home() / ".hermes" / "skills" / "ateneum" / "scripts" / "ateneum_client.py"
    )
    if not client.is_file():
        raise AssertionError(
            f"Ateneum conversation client missing: {client}; set ATENEUM_CLIENT_PATH"
        )
    env = os.environ.copy()
    env["ATENEUM_API_URL"] = base_url.rstrip("/") + "/api/ateneum"
    env["ATENEUM_API_TOKEN"] = token
    env.pop("ATENEUM_USERNAME", None)
    env.pop("ATENEUM_PASSWORD", None)
    result = subprocess.run(
        [sys.executable, str(client), "--json", "--quiet", *args],
        cwd=ROOT,
        env=env,
        text=True,
        capture_output=True,
        timeout=30,
        check=False,
    )
    if result.returncode != 0:
        raise AssertionError(
            f"Ateneum conversation client failed ({result.returncode}): "
            f"stdout={result.stdout!r} stderr={result.stderr!r}"
        )
    return json.loads(result.stdout)


def run_queue_client(base_url: str, *args: str) -> Any:
    configured_client = os.environ.get("ATENEUM_CLIENT_PATH")
    client = (
        Path(configured_client).expanduser().resolve()
        if configured_client
        else Path.home() / ".hermes" / "skills" / "ateneum" / "scripts" / "ateneum_client.py"
    )
    env = os.environ.copy()
    env["ATENEUM_API_URL"] = base_url.rstrip("/") + "/api/ateneum"
    env["ATENEUM_BOT_USERNAME"] = "ateneum-bot"
    env["ATENEUM_BOT_PASSWORD"] = "qa-bot-password"
    env.pop("ATENEUM_API_TOKEN", None)
    result = subprocess.run(
        [sys.executable, str(client), "--json", "--quiet", *args],
        cwd=ROOT, env=env, text=True, capture_output=True, timeout=30, check=False,
    )
    if result.returncode != 0:
        raise AssertionError(
            f"Ateneum queue client failed ({result.returncode}): stdout={result.stdout!r} stderr={result.stderr!r}"
        )
    return json.loads(result.stdout)


def visible_controls_expression(title: str) -> str:
    return f"""(() => {{
      const card = [...document.querySelectorAll('.activity')]
        .find(node => node.textContent.includes({json.dumps(title)}));
      if (!card) return -1;
      return [...card.querySelectorAll('button')]
        .filter(button => getComputedStyle(button).display !== 'none' && button.getBoundingClientRect().height > 0).length;
    }})()"""


def run_browser_qa(base_url: str, chrome_port: int) -> dict[str, Any]:
    version = wait_json(f"http://127.0.0.1:{chrome_port}/json/version")
    cdp = CDP(version["webSocketDebuggerUrl"])
    marker = f"QA-yhteinen-retki-{int(time.time())}"
    notes_a = "QA lähtö perjantaina"
    notes_b = "QA lähtö lauantaina"
    future_date = time.strftime("%Y-%m-%d", time.localtime(time.time() + 14 * 86_400))
    expected_conflicts = 0
    try:
        a = create_page(cdp, base_url, 390, 844)
        b = create_page(cdp, base_url, 980, 900)
        bot = create_page(cdp, base_url, 390, 844)
        a.login("juuso-qa", "qa-juuso-password")
        b.login("henna-qa", "qa-henna-password")
        bot.login("ateneum-bot", "qa-bot-password")
        cdp.errors.clear()
        cdp.responses.clear()
        cdp.requests.clear()

        # Conversation client creates a private Split-level plan draft with a narrowly scoped token.
        token_result = a.eval(
            """fetch('/api/ateneum/auth/api-token', {
              method: 'POST', credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: 'browser-qa-into-plan', password: 'qa-juuso-password',
                expiresInDays: 1, scopes: ['read', 'plans:draft']
              })
            }).then(async response => ({ status: response.status, body: await response.json() }))""",
            await_promise=True,
        )
        assert token_result["status"] == 200, f"plan token issuance failed: {token_result}"
        plan_token = token_result["body"]["token"]
        plan_marker = f"QA-Split-kokonaisuus-{int(time.time())}"
        original_summary = "Agentin luonnostelema viikon yhteinen QA-matka."
        revised_summary = "Uusi yksityinen revisio: päiväretki lisätty."
        with tempfile.TemporaryDirectory(prefix="ateneum-plan-client-") as plan_temp:
            content_path = Path(plan_temp) / "plan-v1.json"
            content_path.write_text(
                json.dumps(
                    {
                        "sections": [
                            {
                                "id": "overview",
                                "title": "Yleiskatsaus",
                                "type": "overview",
                                "summary": "Matkan yhteinen suunta.",
                                "facts": [{"label": "Kesto", "value": "7 yötä"}],
                                "items": [],
                                "checklist": ["Tarkista passit"],
                            },
                            {
                                "id": "itinerary",
                                "title": "Päiväohjelma",
                                "type": "itinerary",
                                "facts": [],
                                "items": [
                                    {
                                        "title": "Saapuminen ja rauhallinen ilta",
                                        "description": "Ei suorittamista ensimmäiselle päivälle.",
                                        "priority": "high",
                                    }
                                ],
                                "checklist": [],
                            },
                        ]
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            created_plan = run_plan_client(
                base_url,
                plan_token,
                "create-plan-draft",
                "--title",
                plan_marker,
                "--plan-type",
                "trip",
                "--start-date",
                "2026-08-03",
                "--end-date",
                "2026-08-10",
                "--summary",
                original_summary,
                "--content-file",
                str(content_path),
            )
            plan_id = created_plan["id"]
            assert created_plan["status"] == "draft"
            assert created_plan["visibility"] == "private"
            assert created_plan["draftedBy"] == "into"
            assert created_plan["ownerDisplayName"] == "Juuso QA"

            # Only the requesting human sees the private draft.
            a.eval("showView('plans')")
            a.wait(f"document.querySelector('.plan-card[data-plan-id={json.dumps(plan_id)}].draft')")
            private_text = a.eval(f"document.querySelector('.plan-card[data-plan-id={json.dumps(plan_id)}]').textContent")
            assert "Luonnos näkyy vain sinulle" in private_text
            assert "Innon luonnostelema Juuso QAn pyynnöstä" in private_text
            plan_tap_heights = a.eval(
                f"[...document.querySelector('.plan-card[data-plan-id={json.dumps(plan_id)}]').querySelectorAll('button, a.btn')].map(node => node.getBoundingClientRect().height)"
            )
            assert plan_tap_heights and min(plan_tap_heights) >= 44, f"plan tap target below 44px: {plan_tap_heights}"
            assert a.eval("document.documentElement.scrollWidth <= window.innerWidth + 1"), "mobile plan list overflows"

            # The plan detail uses the same compact, switching tab interaction as rich activity details.
            a.navigate(f"/ateneum/plan.html?id={plan_id}")
            a.wait("document.querySelectorAll('.tab-btn').length === 8")
            assert a.eval("document.querySelector('.tab-btn[data-tab=overview]').classList.contains('active')")
            assert a.eval("document.querySelector('.tab-content[data-tab=itinerary]').offsetParent === null")
            a.eval("document.querySelector('.tab-btn[data-tab=itinerary]').click()")
            a.wait("document.querySelector('.tab-content[data-tab=itinerary]').classList.contains('active')")
            assert "Saapuminen ja rauhallinen ilta" in a.eval("document.querySelector('.tab-content[data-tab=itinerary]').textContent")
            assert a.eval("Boolean(document.getElementById('enhance-plan-form') && document.getElementById('enhance-instruction'))")
            assert "Vain sinä ja Into" in a.eval("document.querySelector('.enhance-panel').textContent")
            enhancement_controls = a.eval("[...document.querySelectorAll('#enhance-instruction, #enhance-plan')].map(node => node.getBoundingClientRect().height)")
            assert enhancement_controls and min(enhancement_controls) >= 44, f"enhancement control below 44px: {enhancement_controls}"
            detail_tap_heights = a.eval("[...document.querySelectorAll('.tab-btn')].map(node => node.getBoundingClientRect().height)")
            assert detail_tap_heights and min(detail_tap_heights) >= 44, f"plan detail tab below 44px: {detail_tap_heights}"
            assert a.eval("document.documentElement.scrollWidth <= window.innerWidth + 1"), "mobile plan detail overflows"
            a.navigate("/ateneum/?view=plans")
            a.wait(f"document.querySelector('.plan-card[data-plan-id={json.dumps(plan_id)}].draft')")

            b.eval("showView('plans')")
            b.wait("document.getElementById('plans-count').textContent === '(0)'")
            assert not b.eval(f"document.querySelector('.plan-card[data-plan-id={json.dumps(plan_id)}]')")
            bot.eval("showView('plans')")
            bot.wait("document.getElementById('plans-count').textContent === '(0)'")
            assert not bot.eval(f"document.querySelector('.plan-card[data-plan-id={json.dumps(plan_id)}]')")

            # The owner shares from UI; partner and bot then see the proposal, but bot has no controls.
            a.eval("window.confirm = () => true")
            a.click_in_card(plan_marker, 'button[onclick^="sharePlan"]')
            a.wait(f"document.querySelector('.plan-card[data-plan-id={json.dumps(plan_id)}].proposed')")
            b.eval("showView('plans')")
            b.wait(f"document.querySelector('.plan-card[data-plan-id={json.dumps(plan_id)}].proposed')")
            partner_plan_text = b.eval(f"document.querySelector('.plan-card[data-plan-id={json.dumps(plan_id)}]').textContent")
            assert "odottaa sinun vastaustasi" in partner_plan_text.lower()
            assert "Hyväksy versio" in partner_plan_text

            bot.eval("showView('plans')")
            bot.wait(f"document.querySelector('.plan-card[data-plan-id={json.dumps(plan_id)}].proposed')")
            bot_plan_text = bot.eval(f"document.querySelector('.plan-card[data-plan-id={json.dumps(plan_id)}]').textContent")
            assert "Odottaa toisen kumppanin vastausta" in bot_plan_text
            assert not bot.eval(f"document.querySelector('.plan-card[data-plan-id={json.dumps(plan_id)}] button')"), "bot sees plan write controls"
            bot.navigate(f"/ateneum/plan.html?id={plan_id}")
            bot.wait("document.querySelector('.status-pill.proposed')")
            assert not bot.eval("document.querySelector('#share-plan, #accept-plan, #return-plan')"), "bot sees plan detail controls"
            assert not bot.eval("document.querySelector('.enhance-panel')"), "bot sees private enhancement UI"
            assert "Odottaa toisen kumppanin vastausta" in bot.eval("document.querySelector('.plan-state').textContent")

            # Partner accepts on the detail page; the exact same revision becomes mutual.
            b.navigate(f"/ateneum/plan.html?id={plan_id}")
            b.wait("document.querySelector('.status-pill.proposed') && document.getElementById('accept-plan')")
            assert b.eval("document.querySelectorAll('.section').length") == 2
            b.click("#accept-plan")
            b.wait("document.querySelector('.status-pill.accepted') && !document.getElementById('accept-plan')")
            assert "Molemmat hyväksyivät" in b.eval("document.querySelector('.plan-state').textContent")
            assert not b.eval("document.querySelector('.enhance-panel')"), "partner sees owner's enhancement UI"
            a.eval("showView('plans')")
            a.wait(f"document.querySelector('.plan-card[data-plan-id={json.dumps(plan_id)}].accepted')")
            bot.eval("window.dispatchEvent(new Event('focus'))")
            bot.wait("document.querySelector('.status-pill.accepted')")

            # Owner asks Into for a revision in the UI. The worker completes it into private version 2.
            revised_path = Path(plan_temp) / "plan-v2.json"
            revised_content = json.loads(content_path.read_text(encoding="utf-8"))
            revised_content["sections"][1]["items"].append(
                {"title": "Päiväretki saarelle", "description": "Vaihtoehto sään mukaan.", "priority": "medium"}
            )
            revised_path.write_text(json.dumps(revised_content, ensure_ascii=False), encoding="utf-8")
            a.navigate(f"/ateneum/plan.html?id={plan_id}")
            a.wait("document.querySelector('.status-pill.accepted') && document.getElementById('enhance-instruction')")
            a.set_value("#enhance-instruction", "Lisää päiväretki ja pidä hyväksytty versio kumppanin näkyvissä.")
            a.click("#enhance-plan")
            a.wait("document.querySelector('.enhance-panel[data-enhancement-status=pending]')")
            assert "tunnin sisällä" in a.eval("document.querySelector('.enhance-panel').textContent")

            enhancement_request = run_queue_client(base_url, "claim-plan-request")
            assert enhancement_request and enhancement_request["sourceType"] == "plan"
            assert enhancement_request["planId"] == plan_id
            assert enhancement_request["baseVersion"] == 1
            assert enhancement_request["plan"]["version"] == 1
            assert enhancement_request["brief"]["goal"].startswith("Lisää päiväretki")
            a.eval("window.dispatchEvent(new Event('focus'))")
            a.wait("document.querySelector('.enhance-panel[data-enhancement-status=processing]')")

            completed_enhancement = run_queue_client(
                base_url,
                "complete-plan-request",
                enhancement_request["id"],
                "--expected-attempt", str(enhancement_request["attemptCount"]),
                "--title", plan_marker,
                "--plan-type", "trip",
                "--start-date", "2026-08-03",
                "--end-date", "2026-08-10",
                "--summary",
                revised_summary,
                "--content-file",
                str(revised_path),
            )
            assert completed_enhancement["plan"]["id"] == plan_id
            assert completed_enhancement["plan"]["version"] == 2
            listed_plans = run_plan_client(base_url, plan_token, "list-plans")
            assert any(item["id"] == plan_id and item["version"] == 2 for item in listed_plans)

            a.eval("window.dispatchEvent(new Event('focus'))")
            a.wait("document.querySelector('.status-pill.draft') && document.querySelector('.meta').textContent.includes('Versio 2') && document.getElementById('enhance-instruction')")
            assert "näkyy vain sinulle" in a.eval("document.querySelector('.plan-state').textContent")
            b.eval("window.dispatchEvent(new Event('focus'))")
            b.wait("document.querySelector('.status-pill.accepted') && document.querySelector('.meta').textContent.includes('Versio 1')")
            assert original_summary in b.eval("document.querySelector('.summary').textContent")
            assert revised_summary not in b.eval("document.body.textContent")
            bot.eval("window.dispatchEvent(new Event('focus'))")
            bot.wait("document.querySelector('.status-pill.accepted') && document.querySelector('.meta').textContent.includes('Versio 1')")

        plan_http_errors = [response for response in cdp.responses if int(response.get("status", 0)) >= 400]
        assert not plan_http_errors, f"unexpected plan browser HTTP failures: {plan_http_errors}"
        assert not cdp.errors, f"plan browser console/runtime failures: {cdp.errors}"

        # Return all contexts to the main application for the existing activity QA.
        for page, username in ((a, "juuso-qa"), (b, "henna-qa"), (bot, "ateneum-bot")):
            page.navigate("/ateneum/")
            page.wait(f"typeof currentUser !== 'undefined' && currentUser && currentUser.username === {json.dumps(username)}")
        cdp.errors.clear()
        cdp.responses.clear()
        cdp.requests.clear()

        # A creates a user-authored idea from the mobile UI.
        a.click('nav.tabs button[data-view="ideas"]')
        a.wait("document.getElementById('ideas-list').dataset.loaded === '1'")
        a.click('#view-ideas > button[onclick="showIdeaForm()"]')
        a.set_value("#if-title", marker)
        a.set_value("#if-description", "Kahden yön yhteinen QA-retki")
        a.set_value("#if-duration", "2880")
        a.set_value("#if-tags", "qa, yhdessä")
        a.click('#idea-form button[onclick="submitIdea(this)"]')
        a.wait(
            f"[...document.querySelectorAll('.idea')].some(node => node.textContent.includes({json.dumps(marker)}) && node.textContent.includes('Jakanut Juuso QA'))",
            message="new idea or its creator attribution did not appear",
        )
        assert a.eval("document.documentElement.scrollWidth <= window.innerWidth + 1"), "mobile idea view overflows"

        # A can queue a rich private plan from the idea without starting synchronous agent work.
        idea_id = a.eval(
            f"[...document.querySelectorAll('.idea')].find(node => node.textContent.includes({json.dumps(marker)})).dataset.ideaId"
        )
        a.click_in_card(marker, 'button[onclick="openPlanRequest(this)"]')
        a.wait(f"[...document.querySelectorAll('.idea')].find(node => node.textContent.includes({json.dumps(marker)}))?.querySelector('.plan-request-panel')")
        a.set_card_value(marker, ".pr-goal", "Tee rauhallinen kahden yön valmis matkasuunnitelma.")
        a.set_card_value(marker, ".pr-type", "trip")
        a.set_card_value(marker, ".pr-timing", future_date)
        a.set_card_value(marker, ".pr-budget", "800 euroa")
        a.set_card_value(marker, ".pr-must", "Yksi hyvä illallinen ja väljää aikaa")
        request_tap_heights = a.eval(
            f"""(() => {{ const card=[...document.querySelectorAll('.idea')].find(node=>node.textContent.includes({json.dumps(marker)}));
              return [...card.querySelectorAll('.plan-request-panel button')].map(button=>button.getBoundingClientRect().height); }})()"""
        )
        assert request_tap_heights and min(request_tap_heights) >= 44, f"plan request tap target below 44px: {request_tap_heights}"
        a.click_in_card(marker, 'button[onclick="submitPlanRequest(this)"]')
        a.wait(f"[...document.querySelectorAll('.idea')].find(node => node.textContent.includes({json.dumps(marker)}))?.textContent.includes('Jonossa')")
        assert a.eval("document.documentElement.scrollWidth <= window.innerWidth + 1"), "mobile plan request overflows"

        b.eval("showView('ideas')")
        b.wait(f"[...document.querySelectorAll('.idea')].some(node => node.textContent.includes({json.dumps(marker)}))")
        b_queue_text = b.eval(f"[...document.querySelectorAll('.idea')].find(node => node.textContent.includes({json.dumps(marker)})).textContent")
        assert "Jonossa" not in b_queue_text, "another human sees the requester's private queue state"
        assert b.eval(f"Boolean([...document.querySelectorAll('.idea')].find(node => node.textContent.includes({json.dumps(marker)})).querySelector('button[onclick=\"openPlanRequest(this)\"]'))")

        queued_request = run_queue_client(base_url, "claim-plan-request")
        assert queued_request and queued_request["ideaId"] == idea_id
        with tempfile.TemporaryDirectory(prefix="ateneum-queue-client-") as queue_temp:
            queue_content = Path(queue_temp) / "content.json"
            queue_content.write_text(
                json.dumps({"sections": [{
                    "id": "overview", "title": "Yleiskatsaus", "type": "overview",
                    "summary": "Rauhallinen kahden yön kokonaisuus.", "facts": [], "items": [], "checklist": [],
                }]}, ensure_ascii=False),
                encoding="utf-8",
            )
            completed_queue = run_queue_client(
                base_url,
                "complete-plan-request",
                queued_request["id"],
                "--expected-attempt", str(queued_request["attemptCount"]),
                "--title", marker,
                "--plan-type", "trip",
                "--start-date", future_date,
                "--end-date", future_date,
                "--summary", "Jonosta rakennettu yksityinen QA-suunnitelma.",
                "--content-file", str(queue_content),
            )
        queued_plan_id = completed_queue["plan"]["id"]
        a.eval("showView('ideas')")
        a.wait(f"[...document.querySelectorAll('.idea')].find(node => node.textContent.includes({json.dumps(marker)}))?.querySelector('a[href=\"/ateneum/plan.html?id={queued_plan_id}\"]')")

        # A proposes an explicit long duration from the idea card.
        a.click_in_card(marker, "button[data-suggestion]")
        a.wait(f"[...document.querySelectorAll('.idea')].find(node => node.textContent.includes({json.dumps(marker)}))?.querySelector('.planner-panel')")
        a.set_card_value(marker, ".pp-date", future_date)
        a.set_card_value(marker, ".pp-time", "18:00")
        a.set_card_value(marker, ".pp-duration", "2880")
        a.set_card_value(marker, ".pp-notes", notes_a)
        tap_heights = a.eval(
            f"""(() => {{ const card=[...document.querySelectorAll('.idea')].find(node=>node.textContent.includes({json.dumps(marker)}));
              return [...card.querySelectorAll('.planner-panel button')].map(button=>button.getBoundingClientRect().height); }})()"""
        )
        assert tap_heights and min(tap_heights) >= 44, f"planner tap target below 44px: {tap_heights}"
        a.click_in_card(marker, 'button[onclick="confirmPlan(this)"]')
        a.wait(f"[...document.querySelectorAll('.success-card')].some(node => node.textContent.includes({json.dumps(marker)}))")
        assert a.eval("document.documentElement.scrollWidth <= window.innerWidth + 1"), "mobile planner overflows"
        activity_generation = int(a.eval("loadGenerations.activities || 0"))
        a.click(".success-card .btn-primary")
        a.wait(
            f"loadGenerations.activities > {activity_generation} && [...document.querySelectorAll('.activity')].some(node => node.textContent.includes({json.dumps(marker)}))",
            message="fresh home activity generation did not finish",
        )
        activity_id = a.eval(
            f"[...document.querySelectorAll('.activity')].find(node => node.textContent.includes({json.dumps(marker)})).dataset.aid"
        )
        assert activity_id
        a_text = a.eval(
            f"[...document.querySelectorAll('.activity')].find(node => node.textContent.includes({json.dumps(marker)})).textContent"
        )
        assert "aikaehdotus" in a_text.lower() and "Odottaa kumppanin vastausta" in a_text
        assert "✓ Tehty" not in a_text
        assert "Laajenna kokonaisuudeksi" in a_text, f"activity expansion action missing: {a_text!r}"

        # A can expand the proposed time into a private rich plan without changing the proposal.
        activity_card = f'.activity[data-aid="{activity_id}"]'
        a.click(f'{activity_card} button[onclick="openPlanRequest(this)"]')
        a.wait(f"document.querySelector({json.dumps(activity_card + ' .plan-request-panel')})")
        assert a.eval(f"document.querySelector({json.dumps(activity_card + ' .pr-timing')}).value"), "activity timing was not prefilled"
        a.set_value(f"{activity_card} .pr-goal", "Tee aikaehdotuksesta valmis rauhallinen retkikokonaisuus.")
        a.set_value(f"{activity_card} .pr-type", "event")
        a.set_value(f"{activity_card} .pr-budget", "300 euroa")
        a.click(f'{activity_card} button[onclick="submitPlanRequest(this)"]')
        a.wait(f"document.querySelector({json.dumps(activity_card)})?.textContent.includes('Jonossa')")
        assert "aikaehdotus" in a.eval(f"document.querySelector({json.dumps(activity_card)}).textContent").lower()

        b.eval("showView('home')")
        b.wait(f"document.querySelector({json.dumps(activity_card)})")
        partner_activity_text = b.eval(f"document.querySelector({json.dumps(activity_card)}).textContent")
        assert "Jonossa" not in partner_activity_text, "partner sees requester's private activity queue state"
        partner_expand_selector = activity_card + ' button[onclick="openPlanRequest(this)"]'
        assert b.eval(f"Boolean(document.querySelector({json.dumps(partner_expand_selector)}))")

        activity_request = run_queue_client(base_url, "claim-plan-request")
        assert activity_request and activity_request["sourceType"] == "activity"
        assert activity_request["activityId"] == activity_id
        assert activity_request["activity"]["planState"] == "proposed"
        with tempfile.TemporaryDirectory(prefix="ateneum-activity-queue-") as activity_queue_temp:
            activity_content = Path(activity_queue_temp) / "content.json"
            activity_content.write_text(
                json.dumps({"sections": [{
                    "id": "overview", "title": "Retken kokonaisuus", "type": "overview",
                    "summary": "Aikaehdotuksesta rakennettu kokonaisuus.", "facts": [], "items": [], "checklist": [],
                }]}, ensure_ascii=False),
                encoding="utf-8",
            )
            completed_activity_queue = run_queue_client(
                base_url,
                "complete-plan-request",
                activity_request["id"],
                "--expected-attempt", str(activity_request["attemptCount"]),
                "--title", f"{marker} — laaja kokonaisuus",
                "--plan-type", "event",
                "--start-date", future_date,
                "--end-date", future_date,
                "--summary", "Aikaehdotuksesta rakennettu yksityinen QA-suunnitelma.",
                "--content-file", str(activity_content),
            )
        activity_plan_id = completed_activity_queue["plan"]["id"]
        activity_plan_link = activity_card + f' a[href="/ateneum/plan.html?id={activity_plan_id}"]'
        a.eval("showView('home')")
        a.wait(f"document.querySelector({json.dumps(activity_plan_link)})")
        assert "aikaehdotus" in a.eval(f"document.querySelector({json.dumps(activity_card)}).textContent").lower()

        # B sees the same proposal and accepts it; bot sees data but no write controls.
        b.eval("showView('home')")
        b.wait(f"[...document.querySelectorAll('.activity')].some(node => node.textContent.includes({json.dumps(marker)}))")
        b_text = b.eval(f"document.querySelector('.activity[data-aid={json.dumps(activity_id)}]').textContent")
        assert "Odottaa sinun vastaustasi" in b_text and "Hyväksy aika" in b_text and "✓ Tehty" not in b_text

        bot.eval("showView('ideas')")
        bot.wait("document.getElementById('ideas-list').dataset.loaded === '1'")
        assert bot.eval(
            "[...document.querySelectorAll('#view-ideas .human-write')].every(node => getComputedStyle(node).display === 'none')"
        ), "bot sees idea write controls"
        bot.eval("showView('home')")
        bot.wait(f"document.querySelector('.activity[data-aid={json.dumps(activity_id)}]')")
        assert bot.eval(visible_controls_expression(marker)) == 0, "bot sees activity write controls"
        bot_text = bot.eval(f"document.querySelector('.activity[data-aid={json.dumps(activity_id)}]').textContent")
        assert "Odottaa toisen kumppanin vastausta" in bot_text and "Odottaa sinun vastaustasi" not in bot_text

        b.click_in_card(marker, 'button[onclick^="acceptActivity"]')
        b.wait(f"document.querySelector('.activity[data-aid={json.dumps(activity_id)}] .status-chip.accepted')")
        a.eval("showView('home')")
        a.wait(f"document.querySelector('.activity[data-aid={json.dumps(activity_id)}] .status-chip.accepted')")

        # A holds version 1 open. B changes only notes, creating version 2.
        a.click_in_card(marker, "button[data-activity]")
        a.wait(f"document.querySelector('.activity[data-aid={json.dumps(activity_id)}] .activity-editor')")
        b.click_in_card(marker, "button[data-activity]")
        b.wait(f"document.querySelector('.activity[data-aid={json.dumps(activity_id)}] .activity-editor')")
        b.set_card_value(marker, ".ae-notes", notes_b)
        b.click_in_card(marker, 'button[onclick="saveActivityEdit(this)"]')
        b.wait(
            f"document.querySelector('.activity[data-aid={json.dumps(activity_id)}]')?.textContent.includes({json.dumps(notes_b)})"
        )
        patch_requests = [
            request for request in cdp.requests
            if request.get("method") == "PATCH" and request.get("url", "").endswith(f"/activities/{activity_id}")
        ]
        assert patch_requests, "counterproposal PATCH was not observed"
        patch_body = json.loads(patch_requests[-1].get("postData", "{}"))
        assert set(patch_body) == {"expectedVersion", "notes"}, f"editor sent unchanged fields: {patch_body}"

        # A's stale editor must get 409 and reload B's current notes.
        a.set_card_value(marker, ".ae-time", "19:30")
        a.click_in_card(marker, 'button[onclick="saveActivityEdit(this)"]')
        a.wait(
            f"(() => {{ const card = document.querySelector('.activity[data-aid={json.dumps(activity_id)}]'); return Boolean(card && card.textContent.includes({json.dumps(notes_b)}) && !card.querySelector('.activity-editor')); }})()",
            message="stale editor did not reload the partner's current version",
        )
        conflicts = [
            response for response in cdp.responses
            if response.get("status") == 409 and response.get("url", "").endswith(f"/activities/{activity_id}")
        ]
        expected_conflicts = len(conflicts)
        assert expected_conflicts >= 1, "stale editor did not receive HTTP 409"

        # Alternate detail entry opens the actual editor through a deep link.
        a.navigate(f"/ateneum/activity.html?id={activity_id}")
        a.wait("document.querySelector('.status-pill.proposed') && document.getElementById('hero-accept')")
        a.click('a[href*="editActivity="]')
        a.wait(
            f"location.search.includes('editActivity=') && document.querySelector('.activity[data-aid={json.dumps(activity_id)}] .activity-editor')",
            message="detail change action did not open the activity editor",
        )
        a.navigate(f"/ateneum/activity.html?id={activity_id}")
        a.wait("document.querySelector('.status-pill.proposed') && document.getElementById('hero-accept')")
        a.click("#hero-accept")
        a.wait("document.querySelector('.status-pill.accepted') && document.getElementById('hero-mark-done')")

        # Cancellation is global and attributed. Reopening becomes a fresh proposal.
        a.eval("window.confirm = () => true")
        a.click("#hero-skip")
        a.wait("document.querySelector('.status-pill.skipped') && document.getElementById('hero-undo')")
        assert "Juuso QA" in a.eval("document.querySelector('.plan-state').textContent")
        a.click("#hero-undo")
        a.wait("document.querySelector('.status-pill.proposed') && !document.getElementById('hero-mark-done')")
        assert "Odottaa kumppanin vastausta" in a.eval("document.querySelector('.plan-state').textContent")

        # B returns to the foreground, observes the fresh proposal, and accepts it.
        b.eval("window.dispatchEvent(new Event('focus'))")
        b.wait(
            f"(() => {{ const card = document.querySelector('.activity[data-aid={json.dumps(activity_id)}]'); return Boolean(card && card.textContent.includes('Odottaa sinun vastaustasi') && card.querySelector('button[onclick^=\"acceptActivity\"]')); }})()",
            message="focus refresh did not expose the reopened proposal to the partner",
        )
        b.click_in_card(marker, 'button[onclick^="acceptActivity"]')
        b.wait(f"document.querySelector('.activity[data-aid={json.dumps(activity_id)}] .status-chip.accepted')")

        # A can complete only after B's acceptance. Detail focus refresh exposes it without a manual reload.
        a.eval("window.dispatchEvent(new Event('focus'))")
        a.wait("document.querySelector('.status-pill.accepted') && document.getElementById('hero-mark-done')")
        a.eval("window.confirm = () => true")
        a.click("#hero-mark-done")
        a.wait("document.querySelector('.status-pill.done')")
        assert not a.eval("document.getElementById('hero-stars')"), "mutual detail rendered a shared rating"
        b.eval("window.dispatchEvent(new Event('focus'))")
        b.wait(f"document.querySelector('.activity[data-aid={json.dumps(activity_id)}] .status-chip.done')")
        assert not b.eval(f"document.querySelector('.activity[data-aid={json.dumps(activity_id)}] .stars')"), "mutual list rendered a shared rating"
        assert b.eval(f"Boolean(document.querySelector('.activity[data-aid={json.dumps(activity_id)}] button[onclick*=\"markPlanned\"]'))"), "completed mutual plan cannot be reopened from list"
        assert a.eval("Boolean(document.getElementById('hero-undo'))"), "completed mutual plan cannot be reopened from detail"
        a.click("#hero-undo")
        a.wait("document.querySelector('.status-pill.proposed') && !document.getElementById('hero-mark-done')")
        b.eval("window.dispatchEvent(new Event('focus'))")
        b.wait(
            f"document.querySelector('.activity[data-aid={json.dumps(activity_id)}] .status-chip.proposed')",
            message="completed mutual plan did not reopen as a fresh proposal",
        )

        # Only the intentionally exercised stale write may fail.
        unexpected_http = [
            response for response in cdp.responses
            if int(response.get("status", 0)) >= 400
            and not (response.get("status") == 409 and response.get("url", "").endswith(f"/activities/{activity_id}"))
        ]
        assert not unexpected_http, f"unexpected browser HTTP failures: {unexpected_http}"
        expected_console_conflict = "console: Failed to load resource: the server responded with a status of 409 (Conflict)"
        unexpected_browser_errors = [
            error for error in cdp.errors if error != expected_console_conflict
        ]
        assert not unexpected_browser_errors, (
            f"browser console/runtime failures: {unexpected_browser_errors}"
        )

        return {
            "activityId": activity_id,
            "ideaTitle": marker,
            "planId": plan_id,
            "activityPlanId": activity_plan_id,
            "planRevision": 2,
            "planClient": "create+list+plan-enhancement-queue+idea-queue+activity-queue",
            "expected409": expected_conflicts,
            "counterproposalPatchKeys": sorted(patch_body),
            "mobileWidth": 390,
            "roles": ["partner_a", "partner_b", "bot"],
        }
    finally:
        cdp.close()


def main() -> None:
    bundle = ROOT / "dist" / "index.cjs"
    if not bundle.is_file():
        raise SystemExit("dist/index.cjs is missing; run npm run build first")
    chrome = os.environ.get("CHROME_BIN") or shutil.which("google-chrome") or shutil.which("chromium")
    if not chrome:
        raise SystemExit("Chrome/Chromium not found; set CHROME_BIN")

    with tempfile.TemporaryDirectory(prefix="ateneum-browser-qa-", ignore_cleanup_errors=True) as temp:
        temp_path = Path(temp)
        app_port = free_port()
        chrome_port = free_port()
        env = os.environ.copy()
        env.update(
            {
                "NODE_ENV": "production",
                "PORT": str(app_port),
                "ATENEUM_DB_PATH": str(temp_path / "ateneum.db"),
                "ATENEUM_PARTNER_A_USERNAME": "juuso-qa",
                "ATENEUM_PARTNER_A_DISPLAY_NAME": "Juuso QA",
                "ATENEUM_PARTNER_A_EMAIL": "juuso-qa@example.test",
                "ATENEUM_PARTNER_A_PASSWORD": "qa-juuso-password",
                "ATENEUM_PARTNER_B_USERNAME": "henna-qa",
                "ATENEUM_PARTNER_B_DISPLAY_NAME": "Henna QA",
                "ATENEUM_PARTNER_B_EMAIL": "henna-qa@example.test",
                "ATENEUM_PARTNER_B_PASSWORD": "qa-henna-password",
                "ATENEUM_BOT_EMAIL": "bot-qa@example.test",
                "ATENEUM_BOT_PASSWORD": "qa-bot-password",
            }
        )
        server_log_path = temp_path / "server.log"
        with server_log_path.open("wb") as server_log:
            server = subprocess.Popen(
                ["node", str(bundle)], cwd=ROOT, env=env, stdout=server_log, stderr=subprocess.STDOUT
            )
            chrome_process = subprocess.Popen(
                [
                    chrome,
                    "--headless=new",
                    "--no-sandbox",
                    "--disable-gpu",
                    "--disable-dev-shm-usage",
                    "--no-first-run",
                    "--no-default-browser-check",
                    "--remote-allow-origins=*",
                    f"--remote-debugging-port={chrome_port}",
                    f"--user-data-dir={temp_path / 'chrome-profile'}",
                    "about:blank",
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            try:
                wait_http(f"http://127.0.0.1:{app_port}/ateneum/")
                result = run_browser_qa(f"http://127.0.0.1:{app_port}", chrome_port)
                print("ATENEUM_BROWSER_QA=PASS")
                print(json.dumps(result, ensure_ascii=False, sort_keys=True))
            except Exception:
                server_log.flush()
                log_tail = server_log_path.read_text(errors="replace").splitlines()[-40:]
                if log_tail:
                    print("--- server log tail ---")
                    print("\n".join(log_tail))
                raise
            finally:
                chrome_process.terminate()
                server.terminate()
                try:
                    chrome_process.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    chrome_process.kill()
                try:
                    server.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    server.kill()


if __name__ == "__main__":
    main()
