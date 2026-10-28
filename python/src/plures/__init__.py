"""Plures: human judgment as an API for AI agents.

Send a decision to ID verified people and get their consensus back.
Python 3.8+, standard library only. Docs: https://plures.si/docs
"""
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

__version__ = "1.6.0"
__all__ = ["Plures", "PluresError", "verify_webhook", "__version__"]


class PluresError(Exception):
    def __init__(self, message, status, type_):
        super().__init__(message)
        self.status = status
        self.type = type_


class Plures:
    def __init__(self, api_key=None, base_url=None, timeout=30):
        api_key = api_key or os.environ.get("PLURES_API_KEY")
        if not api_key:
            raise ValueError("Pass your Plures API key, or set PLURES_API_KEY. Get a free test key at https://plures.si/?for=developers#join")
        base_url = base_url or os.environ.get("PLURES_BASE_URL") or "https://plures.si"
        self.api_key = api_key
        self.base = base_url.rstrip("/")
        self.timeout = timeout

    def _req(self, method, path, body=None, headers=None):
        data = json.dumps(body).encode() if body is not None else None
        h = {"authorization": "Bearer " + self.api_key, "user-agent": "plures-python/" + __version__}
        if data is not None:
            h["content-type"] = "application/json"
        h.update(headers or {})
        for attempt in range(3):
            req = urllib.request.Request(self.base + path, data=data, method=method, headers=h)
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as r:
                    return json.loads(r.read() or b"{}")
            except urllib.error.HTTPError as e:
                if e.code >= 500 and attempt < 2:
                    time.sleep(0.5 * 2 ** attempt)
                    continue
                try:
                    err = json.loads(e.read()).get("error", {})
                except Exception:
                    err = {}
                raise PluresError(err.get("message", "HTTP %d" % e.code), e.code, err.get("type", "api_error"))

    def create_task(self, question, options, idempotency_key=None, **fields):
        """Sends a question to verified people.

        fields: context, image_url, audio_url or video_url with media_seconds (1 to 180), sensitive, instructions, verifiers (odd, 1 to 9), max_verifiers,
        presence_check (default True), webhook_url, metadata, expires_in (seconds),
        escalate (send to your team when verifiers don't agree enough) and
        escalate_below (0 to 1), route ("team" skips verified people and goes straight to
        your team, $0.05 per internal vote live), category (matches your routing rules),
        team (the name of one of your teams), team_votes (how many of the team vote,
        majority decides) and team_unanimous. The result's decided_by is "verifiers" or
        "team"; result["team"] has how your team voted.
        """
        body = dict(fields, question=question, options=options)
        headers = {"idempotency-key": idempotency_key} if idempotency_key else None
        return self._req("POST", "/api/v1/tasks", body, headers)

    def get_task(self, task_id):
        return self._req("GET", "/api/v1/tasks/" + urllib.parse.quote(task_id))

    def list_tasks(self, status=None, limit=None, starting_after=None):
        q = {k: v for k, v in {"status": status, "limit": limit, "starting_after": starting_after}.items() if v is not None}
        return self._req("GET", "/api/v1/tasks" + ("?" + urllib.parse.urlencode(q) if q else ""))

    def get_test_mix(self):
        """Test keys only. How test tasks behave when they don't set metadata.test_outcome."""
        return self._req("GET", "/api/v1/test_mix")

    def set_test_mix(self, mix):
        """Test keys only. Shares that add up to 100, like {"unanimous": 70, "split": 20, "tie": 5, "expired": 5}.
        Test tasks without metadata.test_outcome draw from it, so a share goes to your team. None turns it off.
        A single task can override it with metadata={"test_mix": {...}}."""
        return self._req("PUT", "/api/v1/test_mix", {"mix": mix})

    def clear_test_mix(self):
        """Test keys only. Turns the test mix off, so test tasks come back unanimous."""
        return self._req("DELETE", "/api/v1/test_mix")

    def get_routing(self):
        """Your main team, named teams and rules by category."""
        return self._req("GET", "/api/v1/routing")

    def set_routing(self, team=None, groups=None, rules=None):
        """Sets where tasks go. What you pass replaces what's there; what you leave out stays.
        team: {"emails": [...], "escalate_below": 1, "votes": 3, "unanimous": False, "lead": "ops@acme.com", "passkey": True}
        groups: [{"name": "Finance", "emails": ["ap@acme.com", "cfo@acme.com"], "votes": 2, "lead": "controller@acme.com"}]
        rules: [{"category": "refunds", "route": "team", "group": "Finance"}]"""
        body = {k: v for k, v in {"team": team, "groups": groups, "rules": rules}.items() if v is not None}
        return self._req("PUT", "/api/v1/routing", body)

    def balance(self):
        """Your prepaid credit for live tasks, in US cents: available_cents, held_cents and auto_topup.
        A live task that could cost more than available_cents raises PluresError with type insufficient_credits."""
        return self._req("GET", "/api/v1/balance")

    def cancel_task(self, task_id):
        return self._req("POST", "/api/v1/tasks/" + urllib.parse.quote(task_id) + "/cancel")

    def wait_for(self, task_id, timeout=600, interval=3):
        """Polls until the task is settled. Prefer webhooks in production."""
        end = time.time() + timeout
        while True:
            t = self.get_task(task_id)
            if t["status"] != "pending" or time.time() > end:
                return t
            time.sleep(interval)

    def verify(self, question, options, timeout=600, idempotency_key=None, **fields):
        """Creates a task and waits for people to answer it."""
        t = self.create_task(question, options, idempotency_key=idempotency_key, **fields)
        return t if t["status"] != "pending" else self.wait_for(t["id"], timeout=timeout)


def verify_webhook(raw_body, signature_header, secret, tolerance=300):
    """Checks the Plures-Signature header and returns the parsed event.

    raw_body must be the exact bytes or string received. Raises ValueError if invalid.
    """
    if isinstance(raw_body, bytes):
        raw_body = raw_body.decode()
    parts = dict(p.split("=", 1) for p in (signature_header or "").split(",") if "=" in p)
    try:
        t = int(parts["t"])
        v1 = parts["v1"]
    except (KeyError, ValueError):
        raise ValueError("Missing Plures-Signature header")
    if abs(time.time() - t) > tolerance:
        raise ValueError("Webhook timestamp is too old")
    expected = hmac.new(secret.encode(), ("%d.%s" % (t, raw_body)).encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, v1):
        raise ValueError("Webhook signature does not match")
    return json.loads(raw_body)
