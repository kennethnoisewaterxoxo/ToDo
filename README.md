# ToDo

A personal task manager built around plain text files, AI interaction, and no lock-in.

## How It Works

Tasks are stored as Markdown files with YAML frontmatter in a private GitHub repository. This means your data is human-readable, version-controlled, and not tied to any proprietary service.

There are two ways to interact with your tasks:

**PWA** — a web app you can install on your phone or desktop. It reads and writes task files directly via the GitHub API. Open it at `https://kennethnoisewaterxoxo.github.io/ToDo/`.

**Claude** — via a custom MCP (Model Context Protocol) server, Claude can read, create, complete, and search your tasks using natural language. Ask things like "what's due this week?" or "mark the dentist task done and push the report to Friday."

## Architecture

```
GitHub repo (private)          ← your task files live here
        ↕ GitHub API
        ├── MCP Worker          ← TypeScript, Cloudflare Workers (OAuth-protected)
        │     ↕ MCP (stateless Streamable HTTP)
        │   Claude (desktop, mobile, web) via a claude.ai custom connector
        │
        └── PWA                 ← React, hosted on GitHub Pages
              ↕ browser
            You
```

## Task File Format

Each task is a `.md` file stored under `tasks/{list}/{id}.md`:

```markdown
---
id: 2026-04-07-call-dentist-a3f9c1
title: Call the dentist
list: personal
status: pending
priority: normal
due: 2026-04-10
created: 2026-04-07
recurring:
  interval: 6
  unit: months
  next_due: 2026-10-10
tags: [health]
---

Ask about the crown follow-up.
```

## Recurring Tasks

When you complete a recurring task, the next instance is created automatically with the due date advanced by the configured interval (days, weeks, or months).

## MCP Tools

Claude has access to the following tools:

| Tool | Description |
|---|---|
| `get_tasks` | List tasks, filtered by list, status, or due date |
| `get_today` | Tasks due today or overdue |
| `get_overdue` | Tasks past their due date |
| `get_task` | Full details of a single task including notes |
| `create_task` | Create a new task |
| `complete_task` | Mark done, auto-creates next recurrence |
| `update_task` | Edit any field on a task |
| `snooze_task` | Push a task to a future date |
| `delete_task` | Permanently remove a task |
| `search_tasks` | Search by title or notes |
| `get_lists` | List all task lists |
| `get_shopping_list` / `add_shopping_item` / `remove_shopping_item` / `clear_shopping_list` | Manage the shopping list |

## Components

- **`worker/`** — MCP server in TypeScript on Cloudflare Workers
- **`pwa/`** — React + Vite PWA, deployed to GitHub Pages via GitHub Actions
- **Task data repo** — separate private GitHub repository (`todo-tasks`)

## Setup

1. Create a private GitHub repo for task data with a `tasks/inbox/` folder
2. Generate a GitHub Personal Access Token with `repo` scope
3. Deploy the Worker, from `worker/`:
   ```sh
   npm install
   npx wrangler login
   npx wrangler kv namespace create OAUTH_KV   # paste the id into wrangler.jsonc
   npx wrangler secret put GITHUB_TOKEN
   npx wrangler secret put AUTH_PASSPHRASE     # typed once when connecting Claude
   npx wrangler deploy
   ```
   In claude.ai (Settings → Connectors → Add custom connector) use `https://todo-mcp.<subdomain>.workers.dev/mcp` and enter the passphrase when asked. The connector then appears in Claude on desktop, mobile and web. `npm test` runs the tool tests against a fake GitHub; `npm run dev` runs it locally (put dev values in `.dev.vars`).
4. Open the PWA and enter your token and repo name on the setup screen
