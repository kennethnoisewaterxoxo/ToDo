import os
import base64
import re
from datetime import date, datetime
from typing import Optional
import httpx
import yaml

from models import Task, Recurring

GITHUB_API = "https://api.github.com"


class GitHubClient:
    def __init__(self):
        token = os.environ["GITHUB_TOKEN"]
        repo = os.environ["GITHUB_REPO"]  # e.g. "username/todo-tasks"
        self.repo = repo
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    def _url(self, path: str) -> str:
        return f"{GITHUB_API}/repos/{self.repo}/contents/{path}"

    def _parse_date(self, value) -> Optional[date]:
        if not value:
            return None
        if isinstance(value, date):
            return value
        return datetime.strptime(str(value), "%Y-%m-%d").date()

    def _parse_task(self, path: str, content: str) -> Task:
        # Split frontmatter and body
        match = re.match(r"^---\n(.*?)\n---\n?(.*)", content, re.DOTALL)
        if not match:
            raise ValueError(f"Invalid task file: {path}")

        fm = yaml.safe_load(match.group(1))
        notes = match.group(2).strip()

        recurring = None
        if fm.get("recurring"):
            r = fm["recurring"]
            recurring = Recurring(
                interval=r["interval"],
                unit=r["unit"],
                next_due=self._parse_date(r.get("next_due")),
            )

        return Task(
            id=fm["id"],
            title=fm["title"],
            list=fm["list"],
            status=fm.get("status", "pending"),
            priority=fm.get("priority", "normal"),
            due=self._parse_date(fm.get("due")),
            created=self._parse_date(fm.get("created")),
            completed=self._parse_date(fm.get("completed")),
            snoozed_until=self._parse_date(fm.get("snoozed_until")),
            recurring=recurring,
            tags=fm.get("tags") or [],
            notes=notes,
        )

    def _serialize_task(self, task: Task) -> str:
        fm = task.to_frontmatter()
        body = yaml.dump(fm, default_flow_style=False, allow_unicode=True)
        return f"---\n{body}---\n{task.notes}\n"

    def _task_path(self, task: Task) -> str:
        return f"tasks/{task.list}/{task.id}.md"

    def list_tasks(self) -> list[Task]:
        tasks = []
        with httpx.Client() as client:
            # Get all list folders under tasks/
            resp = client.get(self._url("tasks"), headers=self.headers)
            if resp.status_code == 404:
                return []
            resp.raise_for_status()
            folders = [item for item in resp.json() if item["type"] == "dir"]

            for folder in folders:
                list_name = folder["name"]
                files_resp = client.get(self._url(f"tasks/{list_name}"), headers=self.headers)
                if files_resp.status_code != 200:
                    continue
                files = [f for f in files_resp.json() if f["name"].endswith(".md")]

                for file in files:
                    content_resp = client.get(file["url"], headers=self.headers)
                    if content_resp.status_code != 200:
                        continue
                    raw = base64.b64decode(content_resp.json()["content"]).decode("utf-8")
                    try:
                        tasks.append(self._parse_task(file["path"], raw))
                    except Exception:
                        continue

        return tasks

    def get_task(self, task_id: str) -> Optional[Task]:
        for task in self.list_tasks():
            if task.id == task_id:
                return task
        return None

    def write_task(self, task: Task, message: str = None):
        path = self._task_path(task)
        content = self._serialize_task(task)
        encoded = base64.b64encode(content.encode()).decode()
        commit_message = message or f"{'Update' if self._file_exists(path) else 'Create'} task: {task.title}"

        sha = self._get_sha(path)
        payload = {"message": commit_message, "content": encoded}
        if sha:
            payload["sha"] = sha

        with httpx.Client() as client:
            resp = client.put(self._url(path), headers=self.headers, json=payload)
            resp.raise_for_status()

    def delete_task(self, task: Task, message: str = None):
        path = self._task_path(task)
        sha = self._get_sha(path)
        if not sha:
            return
        payload = {
            "message": message or f"Delete task: {task.title}",
            "sha": sha,
        }
        with httpx.Client() as client:
            resp = client.request("DELETE", self._url(path), headers=self.headers, json=payload)
            resp.raise_for_status()

    def get_lists(self) -> list[str]:
        with httpx.Client() as client:
            resp = client.get(self._url("tasks"), headers=self.headers)
            if resp.status_code == 404:
                return []
            resp.raise_for_status()
            return [item["name"] for item in resp.json() if item["type"] == "dir"]

    def _file_exists(self, path: str) -> bool:
        return self._get_sha(path) is not None

    def _get_sha(self, path: str) -> Optional[str]:
        with httpx.Client() as client:
            resp = client.get(self._url(path), headers=self.headers)
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            return resp.json().get("sha")
