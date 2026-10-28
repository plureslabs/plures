# plures

The official Python client for [Plures](https://plures.si): human judgment as an API for AI agents. Send a decision to ID verified people and get their consensus back before your agent acts. A human in the loop step you can call like any other API.

```bash
pip install plures
```

Python 3.8+, standard library only.

## Use it

```python
from plures import Plures

plures = Plures()  # reads PLURES_API_KEY, or Plures("pk_test_...")

task = plures.verify(
    "Does the invoice match the order?",
    ["Matches", "Does not match"],
    context="Order: 48 chairs, $4,218. Invoice: 48 chairs plus $180 freight, $4,398.",
    verifiers=3,
)
result = task["result"]
if result and result["agreement"] == 1:
    print("Act on:", result["answer"])
else:
    print("Not unanimous: send to the team")
```

Get a free test key at [plures.si](https://plures.si/?for=developers#join). Test keys complete at once with the first option (or `metadata["test_answer"]`) and never reach real people. Set `metadata["test_outcome"]` to `split`, `tie`, `expired` or `slow` to test the cases you route to your own team.

## Production: webhooks

```python
plures.create_task(
    "Should this customer get a refund?", ["Approve", "Decline"],
    context=ticket_text, webhook_url="https://your.app/plures",
    metadata={"order_id": order_id}, idempotency_key="refund-%s" % order_id,
)

# In your webhook handler (Flask shown), pass the raw body exactly as received
from plures import verify_webhook
event = verify_webhook(request.get_data(), request.headers.get("Plures-Signature"), WEBHOOK_SECRET)
```

## API

- `create_task(question, options, idempotency_key=None, **fields)`: fields are `context`, `image_url`, `audio_url` or `video_url` with `media_seconds` (a clip up to 180 seconds that people play through before answering), `sensitive`, `instructions`, `verifiers` (1, 3, 5, 7 or 9), `max_verifiers`, `presence_check` (default True), `webhook_url`, `metadata`, `expires_in`
- `get_task(id)`, `list_tasks(status=None, limit=None, starting_after=None)`, `cancel_task(id)`
- `get_routing()`, `set_routing(team=None, groups=None, rules=None)`: named teams of your own people and rules by category, like `groups=[{"name": "Finance", "emails": ["ap@acme.com"]}], rules=[{"category": "refunds", "route": "team", "group": "Finance"}]`. Send a task with `route="team"` to skip verified people ($0.05 per decision live), or tag it with `category=` and let the rules decide.
- `set_test_mix({"unanimous": 70, "split": 20, "tie": 5, "expired": 5})`, `get_test_mix()`, `clear_test_mix()`: with a test key, makes a share of test tasks split, tie or expire at random so you can test routing to your team without changing your agent. A task can override it with `metadata={"test_mix": {...}}`, and `metadata.test_outcome` beats both.
- `balance()`: your prepaid credit for live tasks, in cents. Live tasks cost $0.20 per answer (more for clips); a task that could cost more than your available credit raises `PluresError` with `type` `insufficient_credits` (status 402).
- `wait_for(id, timeout=600, interval=3)`: poll until settled
- `verify(question, options, timeout=600, **fields)`: create and wait
- `verify_webhook(raw_body, signature_header, secret)`: check a webhook and return the event

Errors raise `PluresError` with `.status` and `.type`. Server errors are retried twice.

Examples for LangGraph and the OpenAI Agents SDK: [github.com/plureslabs/plures](https://github.com/plureslabs/plures/tree/main/examples). Full reference: [plures.si/docs](https://plures.si/docs).
