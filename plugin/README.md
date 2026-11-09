# Plures for Claude

Plures is human judgment as an API for AI agents. This plugin teaches Claude when a decision should get a person's judgment before an agent acts, and gives it the tools to ask.

## What's inside

- **The Plures skill** (`skills/plures`): when to add a human check and when not to, how to call Plures from TypeScript, Python or HTTP, webhooks, test outcomes and agent map checks.
- **The plures-mcp server**: an `ask_humans` tool that sends a question, its options and the material to judge to ID verified people (or to your own team), plus `get_human_answer`, `cancel_human_task` and the agent map tools.

## Setup

When you install the plugin, Claude asks for your Plures API key. A free `pk_test_` key from [plures.si](https://plures.si/?for=developers#join) answers instantly with a simulated result and never reaches real people. A `pk_live_` key sends tasks to verified people, paid from your prepaid Plures credit.

## What it runs and sends

- It runs the `plures-mcp` npm package, version 1.5.2, with `npx` on your machine. Its source is in this repository under `mcp/`.
- The server sends what the agent puts in a task (question, options, context, media links, metadata) to the Plures API at `https://plures.si`, authenticated with your key. Verified people see the question, options and context, never your metadata. The agent map tools send a map of your app's steps, never your code.
- Nothing else is sent anywhere, and the skill itself runs no code.

## Links

- Docs: https://plures.si/docs
- Privacy: https://plures.si/privacy
- Terms: https://plures.si/terms
- Support: hello@plures.si
