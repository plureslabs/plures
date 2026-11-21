# Human in the loop for n8n

Pause an n8n workflow until ID verified people decide, with three built in nodes. No community node needed; works on n8n Cloud and self hosted n8n (its webhook URL must be reachable over https).

## 1. HTTP Request: send the decision

- Method `POST`, URL `https://plures.si/api/v1/tasks`
- Header `Authorization: Bearer pk_test_...` (a free test key answers instantly, so you can run the whole workflow first)
- Body (JSON):

```json
{
  "question": "Should this customer get a full refund?",
  "context": "{{ $json.message }}",
  "options": ["Yes", "No"],
  "verifiers": 3,
  "webhook_url": "{{ $execution.resumeUrl }}"
}
```

`$execution.resumeUrl` is this run's own resume URL, so Plures wakes exactly this run when people have answered.

## 2. Wait: resume on webhook call

Set **Resume** to **On Webhook Call** and the HTTP method to **POST**. Set a time limit too, so a run with no answer goes to your team instead of waiting forever.

## 3. IF: act on agreement

Plures posts a `task.completed` event. Branch on:

```
{{ $json.body.data.result.agreement === 1 && $json.body.data.result.answer === "Yes" }}
```

True goes to your action; false goes to your team (an email, a Slack message, or send the task again with `"route": "team"`).

More: [plures.si/integrations/n8n](https://plures.si/integrations/n8n) and the [API docs](https://plures.si/docs).
