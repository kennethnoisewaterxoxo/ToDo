import os
import uuid
from datetime import date, timedelta
from dateutil.relativedelta import relativedelta
from typing import Optional

from mcp.server.fastmcp import FastMCP

from github_client import GitHubClient
from models import Task, Recurring

os.environ.setdefault("FASTMCP_HOST", "0.0.0.0")
os.environ["FASTMCP_PORT"] = os.environ.get("PORT", "8000")

mcp = FastMCP("todo")
gh = GitHubClient()


def _make_id(title: str) -> str:
    slug = title.lower()[:30].replace(" ", "-")
    slug = "".join(c for c in slug if c.isalnum() or c == "-")
    short = uuid.uuid4().hex[:6]
    return f"{date.today().isoformat()}-{slug}-{short}"


def _next_due(current: date, recurring: Recurring) -> date:
    if recurring.unit == "days":
        return current + timedelta(days=recurring.interval)
    elif recurring.unit == "weeks":
        return current + timedelta(weeks=recurring.interval)
    elif recurring.unit == "months":
        return current + relativedelta(months=recurring.interval)
    return current


def _task_summary(task: Task) -> dict:
    return {
        "id": task.id,
        "title": task.title,
        "list": task.list,
        "status": task.status,
        "priority": task.priority,
        "due": task.due.isoformat() if task.due else None,
        "recurring": bool(task.recurring),
        "tags": task.tags,
    }


@mcp.tool()
def get_lists() -> list[str]:
    """Return all task lists."""
    return gh.get_lists()


@mcp.tool()
def get_tasks(
    list: Optional[str] = None,
    status: Optional[str] = "pending",
    due_before: Optional[str] = None,
    due_after: Optional[str] = None,
) -> list[dict]:
    """
    Return tasks, optionally filtered.

    Args:
        list: Filter by list name (e.g. 'inbox', 'work'). None returns all lists.
        status: Filter by status: 'pending', 'complete', 'snoozed', or None for all.
        due_before: ISO date string (YYYY-MM-DD). Return tasks due on or before this date.
        due_after: ISO date string (YYYY-MM-DD). Return tasks due on or after this date.
    """
    tasks = gh.list_tasks()

    if list:
        tasks = [t for t in tasks if t.list == list]
    if status:
        tasks = [t for t in tasks if t.status == status]
    if due_before:
        cutoff = date.fromisoformat(due_before)
        tasks = [t for t in tasks if t.due and t.due <= cutoff]
    if due_after:
        floor = date.fromisoformat(due_after)
        tasks = [t for t in tasks if t.due and t.due >= floor]

    tasks.sort(key=lambda t: (t.due or date.max, t.priority))
    return [_task_summary(t) for t in tasks]


@mcp.tool()
def get_today() -> list[dict]:
    """Return all pending tasks due today or overdue."""
    today = date.today()
    tasks = gh.list_tasks()
    tasks = [t for t in tasks if t.status == "pending" and t.due and t.due <= today]
    tasks.sort(key=lambda t: t.due)
    return [_task_summary(t) for t in tasks]


@mcp.tool()
def get_overdue() -> list[dict]:
    """Return all pending tasks that are past their due date."""
    today = date.today()
    tasks = gh.list_tasks()
    tasks = [t for t in tasks if t.status == "pending" and t.due and t.due < today]
    tasks.sort(key=lambda t: t.due)
    return [_task_summary(t) for t in tasks]


@mcp.tool()
def get_task(task_id: str) -> dict:
    """
    Get full details of a single task including notes.

    Args:
        task_id: The task ID.
    """
    task = gh.get_task(task_id)
    if not task:
        return {"error": f"Task {task_id} not found"}
    return task.to_dict()


@mcp.tool()
def create_task(
    title: str,
    list: str = "inbox",
    due: Optional[str] = None,
    priority: str = "normal",
    notes: str = "",
    tags: Optional[list[str]] = None,
    recurring_interval: Optional[int] = None,
    recurring_unit: Optional[str] = None,
) -> dict:
    """
    Create a new task.

    Args:
        title: Task title.
        list: List to add it to (e.g. 'inbox', 'work', 'home').
        due: Due date as ISO string (YYYY-MM-DD).
        priority: 'low', 'normal', or 'high'.
        notes: Optional markdown notes body.
        tags: Optional list of tag strings.
        recurring_interval: Number of days/weeks/months between recurrences.
        recurring_unit: 'days', 'weeks', or 'months'.
    """
    due_date = date.fromisoformat(due) if due else None

    recurring = None
    if recurring_interval and recurring_unit:
        next_due = _next_due(due_date or date.today(), Recurring(recurring_interval, recurring_unit))
        recurring = Recurring(interval=recurring_interval, unit=recurring_unit, next_due=next_due)

    task = Task(
        id=_make_id(title),
        title=title,
        list=list,
        status="pending",
        priority=priority,
        due=due_date,
        created=date.today(),
        recurring=recurring,
        tags=tags or [],
        notes=notes,
    )

    gh.write_task(task, f"Create task: {title}")
    return _task_summary(task)


@mcp.tool()
def complete_task(task_id: str) -> dict:
    """
    Mark a task as complete. If recurring, creates the next instance automatically.

    Args:
        task_id: The task ID to complete.
    """
    task = gh.get_task(task_id)
    if not task:
        return {"error": f"Task {task_id} not found"}

    task.status = "complete"
    task.completed = date.today()
    gh.write_task(task, f"Complete task: {task.title}")

    next_task = None
    if task.recurring and task.due:
        next_due = _next_due(task.due, task.recurring)
        next_task = Task(
            id=_make_id(task.title),
            title=task.title,
            list=task.list,
            status="pending",
            priority=task.priority,
            due=next_due,
            created=date.today(),
            recurring=Recurring(
                interval=task.recurring.interval,
                unit=task.recurring.unit,
                next_due=_next_due(next_due, task.recurring),
            ),
            tags=task.tags,
            notes=task.notes,
        )
        gh.write_task(next_task, f"Create next recurrence: {task.title}")

    return {
        "completed": _task_summary(task),
        "next_instance": _task_summary(next_task) if next_task else None,
    }


@mcp.tool()
def update_task(
    task_id: str,
    title: Optional[str] = None,
    list: Optional[str] = None,
    due: Optional[str] = None,
    priority: Optional[str] = None,
    status: Optional[str] = None,
    notes: Optional[str] = None,
    tags: Optional[list[str]] = None,
) -> dict:
    """
    Update fields on an existing task.

    Args:
        task_id: The task ID to update.
        title: New title.
        list: Move to a different list.
        due: New due date (YYYY-MM-DD).
        priority: New priority ('low', 'normal', 'high').
        status: New status ('pending', 'complete', 'snoozed').
        notes: Replace the notes body.
        tags: Replace the tags list.
    """
    task = gh.get_task(task_id)
    if not task:
        return {"error": f"Task {task_id} not found"}

    old_list = task.list

    if title is not None:
        task.title = title
    if list is not None:
        task.list = list
    if due is not None:
        task.due = date.fromisoformat(due)
    if priority is not None:
        task.priority = priority
    if status is not None:
        task.status = status
    if notes is not None:
        task.notes = notes
    if tags is not None:
        task.tags = tags

    # If list changed, delete old file and write to new path
    if list is not None and list != old_list:
        old_task = Task(**{**task.__dict__, "list": old_list})
        gh.delete_task(old_task, f"Move task {task.title} to {list}")

    gh.write_task(task, f"Update task: {task.title}")
    return _task_summary(task)


@mcp.tool()
def snooze_task(task_id: str, until: str) -> dict:
    """
    Snooze a task until a future date.

    Args:
        task_id: The task ID to snooze.
        until: ISO date string (YYYY-MM-DD) to snooze until.
    """
    task = gh.get_task(task_id)
    if not task:
        return {"error": f"Task {task_id} not found"}

    task.status = "snoozed"
    task.snoozed_until = date.fromisoformat(until)
    gh.write_task(task, f"Snooze task: {task.title} until {until}")
    return _task_summary(task)


@mcp.tool()
def delete_task(task_id: str) -> dict:
    """
    Permanently delete a task.

    Args:
        task_id: The task ID to delete.
    """
    task = gh.get_task(task_id)
    if not task:
        return {"error": f"Task {task_id} not found"}

    gh.delete_task(task, f"Delete task: {task.title}")
    return {"deleted": task_id, "title": task.title}


@mcp.tool()
def search_tasks(query: str) -> list[dict]:
    """
    Search tasks by title or notes content (case-insensitive).

    Args:
        query: Search string.
    """
    q = query.lower()
    tasks = gh.list_tasks()
    matched = [t for t in tasks if q in t.title.lower() or q in t.notes.lower()]
    return [_task_summary(t) for t in matched]


if __name__ == "__main__":
    import uvicorn
    from starlette.middleware.trustedhost import TrustedHostMiddleware
    port = int(os.environ.get("PORT", 8000))
    app = TrustedHostMiddleware(mcp.sse_app(), allowed_hosts=["*"])
    uvicorn.run(app, host="0.0.0.0", port=port)
