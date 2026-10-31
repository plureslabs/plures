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

__version__ = "1.18.0"
__all__ = ["Plures", "PluresError", "verify_webhook", "__version__"]


class PluresError(Exception):
    def __init__(self, message, status, type_):
        super().__init__(message)
        self.status = status
        self.type = type_


class Plures:
    def __init__(self, api_key=None, base_url=None, timeout=30, app=None):
        api_key = api_key or os.environ.get("PLURES_API_KEY")
        if not api_key:
            raise ValueError("Pass your Plures API key, or set PLURES_API_KEY. Get a free test key at https://plures.si/?for=developers#join")
        base_url = base_url or os.environ.get("PLURES_BASE_URL") or "https://plures.si"
        self.api_key = api_key
        self.base = base_url.rstrip("/")
        self.timeout = timeout
        # The app tasks go to when they don't name one, like "support-agent".
        self.app = app or os.environ.get("PLURES_APP") or None

    def _req(self, method, path, body=None, headers=None):
        data = json.dumps(body).encode() if body is not None else None
        h = {"authorization": "Bearer " + self.api_key, "user-agent": "plures-python/" + __version__}
        if data is not None:
            h["content-type"] = "application/json"
        if self.app:
            h["plures-app"] = self.app
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
        majority decides), team_unanimous and app (which of your apps, like "support-agent";
        defaults to the client's app). The result's decided_by is "verifiers" or
        "team"; result["team"] has how your team voted.
        """
        body = dict(fields, question=question, options=options)
        headers = {"idempotency-key": idempotency_key} if idempotency_key else None
        return self._req("POST", "/api/v1/tasks", body, headers)

    def get_task(self, task_id):
        return self._req("GET", "/api/v1/tasks/" + urllib.parse.quote(task_id))

    def list_tasks(self, status=None, limit=None, starting_after=None, app=None):
        q = {k: v for k, v in {"status": status, "limit": limit, "starting_after": starting_after, "app": app}.items() if v is not None}
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

    def list_apps(self):
        """Your apps, the default first. Each agent you run can be its own app."""
        return self._req("GET", "/api/v1/apps")

    def create_app(self, name, id=None):
        """Creates an app. The id, like "support-agent", is made from the name if you leave it out."""
        return self._req("POST", "/api/v1/apps", {k: v for k, v in {"name": name, "id": id}.items() if v is not None})

    def get_app(self, app_id):
        return self._req("GET", "/api/v1/apps/" + urllib.parse.quote(app_id))

    def update_app(self, app_id, name=None, id=None, default=None):
        """Renames an app, changes its id (its tasks move with it), or makes it the default (default=True)."""
        body = {k: v for k, v in {"name": name, "id": id, "default": default}.items() if v is not None}
        return self._req("PATCH", "/api/v1/apps/" + urllib.parse.quote(app_id), body)

    def delete_app(self, app_id):
        """Deletes an app with no tasks."""
        return self._req("DELETE", "/api/v1/apps/" + urllib.parse.quote(app_id))

    def map_guide(self):
        """The steps a coding agent follows to map an app and draft its checks, as markdown."""
        with urllib.request.urlopen(self.base + "/api/v1/map_guide", timeout=self.timeout) as r:
            return r.read().decode()

    def get_map(self, app):
        """An app's latest agent map, with live numbers for each checkpoint."""
        return self._req("GET", "/api/v1/apps/" + urllib.parse.quote(app) + "/map")

    def upload_map(self, app, agent_map, branch=None):
        """Uploads a new version of an app's agent map: {"nodes": [...], "edges": [...], "checkpoints": [...]}.
        A branch other than the main one gets its own map, compared with main, and noted on its pull request."""
        return self._req("PUT", "/api/v1/apps/" + urllib.parse.quote(app) + "/map", agent_map, {"plures-branch": branch} if branch else None)

    def create_map_key(self, app, label=None):
        """A key that can only read and upload this app's map, for CI. The key is in the response once."""
        return self._req("POST", "/api/v1/apps/" + urllib.parse.quote(app) + "/map_keys", {"label": label} if label else {})

    def list_map_keys(self, app):
        return self._req("GET", "/api/v1/apps/" + urllib.parse.quote(app) + "/map_keys")

    def revoke_map_key(self, app, key_id):
        return self._req("DELETE", "/api/v1/apps/" + urllib.parse.quote(app) + "/map_keys/" + urllib.parse.quote(str(key_id)))

    def start_map_run(self, app):
        """Starts a map run where Plures runs Claude, for CI with no Anthropic key. npx plures map does this."""
        return self._req("POST", "/api/v1/apps/" + urllib.parse.quote(app) + "/map_runs", {})

    def list_map_runs(self, app):
        return self._req("GET", "/api/v1/apps/" + urllib.parse.quote(app) + "/map_runs")

    def map_progress(self, app, session, phase="reading", events=None, source="cli"):
        """While mapping, the files being read ([{"path": ...}]), shown live on the map page. File names only."""
        return self._req("POST", "/api/v1/apps/" + urllib.parse.quote(app) + "/map/progress", {"session": session, "phase": phase, "source": source, "events": events or []})

    def check_pr(self, app, check_id, branch=None, error=None):
        """After a branch with the check in it is pushed, Plures opens the pull request. Pass error if adding it failed."""
        body = {"error": error} if error else {"branch": branch}
        return self._req("POST", "/api/v1/apps/" + urllib.parse.quote(app) + "/checks/" + urllib.parse.quote(check_id) + "/pr", body)

    def map_workflow(self, app, branch="main"):
        """The GitHub Actions workflow that maps a repo on every push to its main branch."""
        url = self.base + "/api/v1/map_workflow?" + urllib.parse.urlencode({"app": app, "branch": branch})
        with urllib.request.urlopen(url, timeout=self.timeout) as r:
            return r.read().decode()

    # Map with GitHub: Plures adds a workflow to your repo by pull request and keeps the app's map
    # current on every push. Installing the Plures GitHub App needs a browser once (install_url).

    def github_repos(self):
        """Repos the Plures GitHub App can reach. installed is False until you install it at install_url."""
        return self._req("GET", "/api/v1/github/repos")

    def github_status(self, app):
        """Where an app's GitHub link stands: repo, pull request, mapping on, latest run, last map."""
        return self._req("GET", "/api/v1/apps/" + urllib.parse.quote(app) + "/github")

    def connect_github(self, app, repo):
        """Connects a repo ("owner/name"): sets its map key secret and opens the pull request."""
        return self._req("POST", "/api/v1/apps/" + urllib.parse.quote(app) + "/github", {"repo": repo})

    def run_github(self, app, update=False):
        """Map now: runs the app's map workflow on GitHub. update=True first updates an older workflow."""
        return self._req("POST", "/api/v1/apps/" + urllib.parse.quote(app) + "/github/run", {"update": True} if update else {})

    def turn_on_github(self, app):
        """Turns mapping on by merging the pull request. The repo's own rules (reviews, checks) still apply."""
        return self._req("POST", "/api/v1/apps/" + urllib.parse.quote(app) + "/github/merge", {})

    def disconnect_github(self, app):
        """Revokes the repo's map key. Delete the workflow file in the repo to stop runs."""
        return self._req("DELETE", "/api/v1/apps/" + urllib.parse.quote(app) + "/github")

    def set_checkpoint(self, app, checkpoint_id, status):
        """Marks a suggested check "added", "dismissed" or "suggested"."""
        return self._req("PATCH", "/api/v1/apps/" + urllib.parse.quote(app) + "/map/checkpoints/" + urllib.parse.quote(checkpoint_id), {"status": status})

    # Quality: people grade a sample of your agent's outputs against a rubric, and compare two
    # versions blind before you ship. Emails, phones, card numbers and SSNs are taken out first.

    def sample(self, rubric, output, input=None, app=None, metadata=None, force=None, version=None):
        """Send every output; the rubric's sample rate decides which ones people grade.
        version names what produced it, like "prompt v14", so a drop can be traced to a change."""
        body = {k: v for k, v in {"rubric": rubric, "output": output, "input": input, "version": version, "app": app, "metadata": metadata, "force": force}.items() if v is not None}
        return self._req("POST", "/api/v1/samples", body)

    def compare(self, release, a, b, input=None, question=None, app=None, verifiers=None):
        """A blind release check: a is the current version's output, b the new one's, for the same input."""
        body = {k: v for k, v in {"release": release, "a": a, "b": b, "input": input, "question": question, "app": app, "verifiers": verifiers}.items() if v is not None}
        return self._req("POST", "/api/v1/comparisons", body)

    def get_release(self, release, app=None):
        """How often people preferred the new version, with a 95% range and a verdict."""
        return self._req("GET", "/api/v1/releases/" + urllib.parse.quote(release) + ("?app=" + urllib.parse.quote(app) if app else ""))

    def list_rubrics(self, app=None):
        return self._req("GET", "/api/v1/rubrics" + ("?app=" + urllib.parse.quote(app) if app else ""))

    def create_rubric(self, name, question, options, sample_rate=None, verifiers=None, drift_points=None, instructions=None, webhook_url=None, app=None):
        """options are grades, best first, like ["Good", "Okay", "Bad"]. sample_rate 0.05 grades 5% of outputs."""
        body = {k: v for k, v in {"name": name, "question": question, "options": options, "sample_rate": sample_rate, "verifiers": verifiers,
                                   "drift_points": drift_points, "instructions": instructions, "webhook_url": webhook_url, "app": app}.items() if v is not None}
        return self._req("POST", "/api/v1/rubrics", body)

    def get_rubric(self, name, app=None):
        """A rubric and its quality: daily scores, this week against the four before, and whether it's drifting."""
        return self._req("GET", "/api/v1/rubrics/" + urllib.parse.quote(name) + ("?app=" + urllib.parse.quote(app) if app else ""))

    def update_rubric(self, name, app=None, **fields):
        return self._req("PATCH", "/api/v1/rubrics/" + urllib.parse.quote(name) + ("?app=" + urllib.parse.quote(app) if app else ""), fields)

    def delete_rubric(self, name, app=None):
        return self._req("DELETE", "/api/v1/rubrics/" + urllib.parse.quote(name) + ("?app=" + urllib.parse.quote(app) if app else ""))

    # Answer reviews: send each turn your assistant answers, with where it routed and what it
    # retrieved. Plures picks the ones worth a look and your team grades them. Free; don't let the
    # user wait on it.
    def log_turn(self, question, answer, intent=None, rerouted_to=None, retrieval=None, sources=None, refused=None,
                 session=None, channel=None, audio_url=None, intents=None, review=False, app=None, metadata=None):
        body = {"question": question, "answer": answer, "intent": intent, "rerouted_to": rerouted_to, "retrieval": retrieval,
                "sources": sources, "refused": refused, "session": session, "channel": channel, "audio_url": audio_url,
                "intents": intents, "review": review or None, "app": app, "metadata": metadata}
        return self._req("POST", "/api/v1/turns", {k: v for k, v in body.items() if v is not None})

    def grade_turn(self, turn_id, **grade):
        """intent_ok, right_intent, grounded (yes, partly, no, should_refuse, should_answer), complete, missed, fact, doc, note."""
        return self._req("POST", "/api/v1/turns/" + urllib.parse.quote(turn_id) + "/grade", grade)

    def turn_insights(self, app, days=None):
        return self._req("GET", "/api/v1/apps/" + urllib.parse.quote(app) + "/turns/insights" + ("?days=" + str(days) if days else ""))

    def export_turns(self, app, kind="qa", since=None):
        """Graded turns as eval data. kind: routes, retrieval, qa or missed."""
        q = {k: v for k, v in {"kind": kind, "since": since}.items() if v}
        h = {"authorization": "Bearer " + self.api_key, "user-agent": "plures-python/" + __version__}
        req = urllib.request.Request(self.base + "/api/v1/apps/" + urllib.parse.quote(app) + "/turns/export?" + urllib.parse.urlencode(q), headers=h)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                return [json.loads(line) for line in r.read().decode().splitlines() if line.strip()]
        except urllib.error.HTTPError as e:
            try:
                err = json.loads(e.read()).get("error", {})
            except Exception:
                err = {}
            raise PluresError(err.get("message") or "HTTP %d" % e.code, e.code, err.get("type") or "api_error")

    def export_graded(self, rubric, app=None, since=None):
        """Graded samples as a list of dicts (input, output, grade, score, agreement), for fine tuning or evals."""
        q = {k: v for k, v in {"app": app or self.app, "since": since}.items() if v}
        h = {"authorization": "Bearer " + self.api_key, "user-agent": "plures-python/" + __version__}
        req = urllib.request.Request(self.base + "/api/v1/rubrics/" + urllib.parse.quote(rubric) + "/export" + ("?" + urllib.parse.urlencode(q) if q else ""), headers=h)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                return [json.loads(line) for line in r.read().decode().splitlines() if line.strip()]
        except urllib.error.HTTPError as e:
            try:
                err = json.loads(e.read()).get("error", {})
            except Exception:
                err = {}
            raise PluresError(err.get("message", "HTTP %d" % e.code), e.code, err.get("type", "api_error"))

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

    def check(self, check_id, data=None, timeout=600, idempotency_key=None, **overrides):
        """Runs a check from your app's map and waits for the decision. Send the data by name; the
        check saved on Plures supplies the question, options, which fields people see, who decides,
        how often and the timeout. Keyword arguments override them for this call (question, options,
        verifiers, team, route, always, sample, timeout). result["answer"] is the option to act on:
        what people chose, the first option when no check was needed or it timed out set to go
        ahead, and None when it timed out set to hold."""
        headers = {"idempotency-key": idempotency_key} if idempotency_key else None
        t = self._req("POST", "/api/v1/checks/" + urllib.parse.quote(check_id), {"data": data or {}, **overrides}, headers)
        final = t if t["status"] != "pending" else self.wait_for(t["id"], timeout=timeout)
        labels = {o["id"]: o["label"] for o in final["options"]}
        first = final["options"][0]["label"] if final["options"] else None
        timed_out = final["status"] in ("expired", "pending")
        if final["status"] == "completed":
            answer = labels.get((final.get("result") or {}).get("answer"), (final.get("result") or {}).get("answer"))
        elif final["status"] == "skipped" or (timed_out and t.get("on_timeout") == "proceed"):
            answer = first
        else:
            answer = None
        return {**final, "check": t.get("check"), "on_timeout": t.get("on_timeout"), "kept_private": t.get("kept_private", []),
                "skipped_because": t.get("skipped_because"), "answer": answer, "checked": final["status"] != "skipped", "timed_out": timed_out}

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
