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
        ├── MCP Server          ← Python, hosted on Railway
        │     ↕ MCP protocol
        │   Claude Desktop / Claude Mobile
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

## Components

- **`mcp-server/`** — Python MCP server using FastMCP, deployed to Railway
- **`pwa/`** — React + Vite PWA, deployed to GitHub Pages via GitHub Actions
- **Task data repo** — separate private GitHub repository (`todo-tasks`)

## Setup

1. Create a private GitHub repo for task data with a `tasks/inbox/` folder
2. Generate a GitHub Personal Access Token with `repo` scope
3. Deploy the MCP server to Railway with `GITHUB_TOKEN`, `GITHUB_REPO`, and `MCP_AUTH_TOKEN` env vars
4. Configure Claude Desktop to connect via `mcp-remote`
5. Open the PWA and enter your token and repo name on the setup screen
