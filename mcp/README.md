# plures-mcp

An MCP server that gives any AI agent a human in the loop: an `ask_humans` tool that sends a decision to ID verified people and returns their consensus before the agent acts. Built on [Plures](https://plures.si).

[![Plures MCP server](https://mcprush.com/badge/plures-mcp/card.svg)](https://mcprush.com/to/plures-mcp?ref=badge)

Works with Claude Desktop, Claude Code, Cursor, VS Code, and agent frameworks that support MCP (OpenAI Agents SDK, LangChain, Vercel AI SDK and more).

## Set up

Get a free test key at [plures.si](https://plures.si/?for=developers#join), then add the server to your client:

```json
{
  "mcpServers": {
    "plures": {
      "command": "npx",
      "args": ["-y", "plures-mcp"],
      "env": { "PLURES_API_KEY": "pk_test_..." }
    }
  }
}
```

Claude Code: `claude mcp add plures --env PLURES_API_KEY=pk_test_... -- npx -y plures-mcp`

A `pk_test_` key answers instantly with a simulated result (always the first option, clearly marked as a test), so you can try the flow for free. A `pk_live_` key sends tasks to real verified people and is paid from prepaid credit at $0.20 per answer, more for recordings and videos by length. If credit runs out, the tool says so; add credit or turn on auto top up at plures.si/dashboard/billing.

## Tools

**`ask_humans`**: send a judgment call to verified people.

Set `route: "team"` to send a decision straight to your own team instead of verified people (for money and account decisions, and confidential or policy calls), `team` to pick one of your named teams, `team_votes` to have several of them vote, and `category` to let your routing rules decide. Live, each internal vote is $0.05.
- `question` (required): what people should decide, answerable from the context alone
- `options` (required): 2 to 8 possible answers
- `context`: the material to judge, as plain text
- `image_url`, `instructions`
- `audio_url` or `video_url` with `media_seconds`: a clip up to 3 minutes that people play through before answering
- `sensitive`: disturbing content, shown only to people who opted in
- `verifiers`: 1, 3, 5, 7 or 9 (default 3)
- `fast`: paid speed for decisions that can't wait; served first and pushed at once, $0.10 more per answer live
- `use_precedent`: look in your judgment graph first. When people already settled cases like this one, it's decided by precedent at once for $0.05 live; one in ten still goes to people as an audit
- `wait_seconds`: how long to wait for the answer, 0 to 240 (default 45). If people haven't answered by then, the tool returns a `task_id` to check later.

**`ask_judgment`**: ask a panel for their honest view when there's no right answer to check. You get the spread of views, `contested: true` when people genuinely split, and a sample of one line reasons.
- `question` (required)
- `format`: `accept` (default: yes, yes with changes, no), `compare` (send `a` and `b`, or `a_image_url` and `b_image_url`, or `a_clip_url` and `b_clip_url` with `a_seconds`, `b_seconds` and `clip_kind`), `rate` (1 to 5, with the average and spread), `flaws` (looks right or has a flaw), `signoff` (coming soon, test keys now: one top rated verified person approves or rejects after a fresh Face ID or Touch ID check, with a reason; $1.00 live), or `custom` (send `options`)
- `context`, `image_url`, `rubric` (what good looks like), `reasons` (`none`, `sample` or `all`), `verifiers` (default 5), `app`, `wait_seconds`

**`audit_my_agent`**: the free audit. Send up to 50 decisions the agent already made (`rows` of `input` and `decision`, or `csv`), with `kind` `check` (was each call right) or `judgment` (would a customer be happy with it), and `about`. Once per account. A person at Plures reviews it first, then ID verified people judge each decision.

**`get_audit_report`**: where the audit is and, once people answer, the decisions they disagreed with. Optional `audit_id`.

**`find_precedents`**: how people decided similar cases before, closest first, with a suggestion when the case is settled. Free.

**`get_taste`**: what the team wants its agents' work to look like: the standing rules in force and recent examples of what they like and don't. Call it before producing work the team will judge. Free.

**`check_against_taste`**: holds a draft (text, a public image link, or both) up against those rules and examples, and says which rules it breaks and why. A check that could not assess the draft is not approval.

**`add_taste_rule`** and **`add_taste_example`**: save a standing rule, or something the team likes or doesn't, when the user says so.

**`get_human_answer`**: check a task by `task_id`, optionally waiting.

**`cancel_human_task`**: cancel a task that no longer matters.

**`get_mapping_guide`**, **`submit_agent_map`**, **`get_agent_map`**: ask your coding agent to "map this app for Plures". It reads the guide, reads your code where it runs, and sends Plures only the map: the steps, the actions with consequences, and a drafted check for each place a person should look. Open the map in your dashboard to try each check and add it.

Each result tells the agent the answer, how many people agreed and whether it is safe to act on. If you've added your team at plures.si/dashboard/team, decisions verified people don't all agree on go to your team, and the agent gets their decision as the final answer.

## When agents should use it

The server tells the agent to ask verified people before acting on judgment calls where a mistake is costly: whether an AI answer is correct and on policy, which of two model responses is better, a customer's tone or intent, whether a listing, document or screenshot matches, a moderation edge case. Not for anything it can check with code or a lookup.

Money and account decisions (refunds, payments, invoices, payouts, account access) go to your own team: the agent sends them with `route: "team"`, or your routing rules can match them by `category`.

Tasks are shown to strangers, so the agent is told not to include secrets or more personal data than the decision needs.

## Environment

- `PLURES_API_KEY` (required)
- `PLURES_BASE_URL` (optional, defaults to https://plures.si)
- `PLURES_APP` (optional): the app tasks and maps belong to, like `support-agent`

MIT licensed. Source: [github.com/plureslabs/plures](https://github.com/plureslabs/plures).
