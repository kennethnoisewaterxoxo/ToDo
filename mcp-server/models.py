from dataclasses import dataclass, field
from typing import Optional
from datetime import date


@dataclass
class Recurring:
    interval: int
    unit: str  # days | weeks | months
    next_due: Optional[date] = None


@dataclass
class Task:
    id: str
    title: str
    list: str
    status: str = "pending"       # pending | complete | snoozed
    priority: str = "normal"      # low | normal | high
    due: Optional[date] = None
    created: Optional[date] = None
    completed: Optional[date] = None
    snoozed_until: Optional[date] = None
    recurring: Optional[Recurring] = None
    tags: list = field(default_factory=list)
    notes: str = ""

    def to_frontmatter(self) -> dict:
        d = {
            "id": self.id,
            "title": self.title,
            "list": self.list,
            "status": self.status,
            "priority": self.priority,
            "created": self.created.isoformat() if self.created else None,
            "due": self.due.isoformat() if self.due else None,
            "completed": self.completed.isoformat() if self.completed else None,
            "snoozed_until": self.snoozed_until.isoformat() if self.snoozed_until else None,
            "tags": self.tags,
        }
        if self.recurring:
            d["recurring"] = {
                "interval": self.recurring.interval,
                "unit": self.recurring.unit,
                "next_due": self.recurring.next_due.isoformat() if self.recurring.next_due else None,
            }
        return d

    def to_dict(self) -> dict:
        d = self.to_frontmatter()
        d["notes"] = self.notes
        return d
