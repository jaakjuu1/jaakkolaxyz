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
              const card = [...document.querySelectorAll('.idea, .activity')]
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
              const card = [...document.querySelectorAll('.idea, .activity')]
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

        # A accepts version 2 from the alternate detail entry point.
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

        # A can complete only after B's acceptance. B sees completion on focus refresh.
        a.eval("loadActivity()", await_promise=True)
        a.wait("document.querySelector('.status-pill.accepted') && document.getElementById('hero-mark-done')")
        a.eval("window.confirm = () => true")
        a.click("#hero-mark-done")
        a.wait("document.querySelector('.status-pill.done')")
        assert not a.eval("document.getElementById('hero-stars')"), "mutual detail rendered a shared rating"
        b.eval("window.dispatchEvent(new Event('focus'))")
        b.wait(f"document.querySelector('.activity[data-aid={json.dumps(activity_id)}] .status-chip.done')")
        assert not b.eval(f"document.querySelector('.activity[data-aid={json.dumps(activity_id)}] .stars')"), "mutual list rendered a shared rating"

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
