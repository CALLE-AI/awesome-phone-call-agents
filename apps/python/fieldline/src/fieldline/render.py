"""Terminal rendering (Rich). The product experience of the CLI."""

from __future__ import annotations

import json
from typing import Any

from rich import box
from rich.console import Console
from rich.panel import Panel
from rich.rule import Rule
from rich.table import Table
from rich.text import Text

from .schemas import TripPlan, mask_phone

Call = dict[str, Any]

_LEVEL_STYLE = {"info": "dim", "ok": "green", "warn": "yellow3", "crit": "bold red"}


class RichRenderer:
    def __init__(self, console: Console | None = None) -> None:
        self.console = console or Console(highlight=False)
        self._party = "Recipient"

    # -- structure -----------------------------------------------------
    def banner(self, plan: TripPlan, demo: bool) -> None:
        c = self.console
        mode = (
            "[black on yellow3] DEMO MODE [/] [yellow3]simulated calls — set CALLE_API_KEY to go live[/]"
            if demo
            else "[black on red] LIVE [/] [red]real phone calls will be placed[/]"
        )
        body = (
            f"[bold cyan]FieldLine[/] — a safety net that phones the field\n"
            f"{mode}\n\n"
            f"[bold]{plan.label}[/]\n"
            f"Site      {plan.site}\n"
            f"Worker    {plan.worker.name} ({plan.worker.role}) · {mask_phone(plan.worker.phone)}\n"
            f"Window    {plan.date} {plan.start}–{plan.end} · check-ins at {', '.join(plan.checkins)}\n"
            f"Ladder    " + "  →  ".join(f"{x.name} ({x.relation})" for x in plan.escalation) + "\n"
            f"Duress    phrase armed · silent protocol"
        )
        c.print(Panel(body, box=box.ROUNDED, border_style="cyan", padding=(1, 2)))

    def section(self, at: str, title: str, level: str = "info") -> None:
        style = {"info": "cyan", "warn": "yellow3", "crit": "red"}.get(level, "cyan")
        label = f"[bold]{at}[/]  {title}" if at else title
        self.console.print()
        self.console.print(Rule(label, style=style))

    # -- calls ---------------------------------------------------------
    def dialing(self, name: str, phone: str, note: str = "") -> None:
        self._party = name
        extra = f"  [dim]{note}[/]" if note else ""
        self.console.print(f"[cyan]📞 CALL-E dialing[/] [bold]{name}[/] [dim]{mask_phone(phone)}[/]{extra}")

    def turn(self, speaker: str, text: str) -> None:
        if speaker == "bot":
            self.console.print(f"   [cyan]agent[/] [cyan]▏[/]{text}")
        else:
            self.console.print(f"   [bold]{self._party.lower()}[/] [white]▏[/][bold]{text}[/]")

    def call_result(self, label: str, call: Call, good: bool) -> None:
        style = "green" if good else "red"
        lines: list[str] = [f"[bold {style}]{label}[/]"]
        if call.get("summary"):
            lines.append(str(call["summary"]))
        sr = call.get("structured_result")
        if isinstance(sr, dict):
            compact = {k: v for k, v in sr.items() if v not in (None, "")}
            lines.append(f"[dim]structured_result[/] [white]{json.dumps(compact, ensure_ascii=False)}[/]")
        cc = call.get("completion_confidence")
        if isinstance(cc, dict) and cc.get("score") is not None:
            lines.append(f"[dim]task_completed={call.get('task_completed')} · confidence {cc['score']:.2f} ({cc.get('label', '')})[/]")
        for ev in call.get("evidence") or []:
            lines.append(f"[dim]· {ev}[/]")
        self.console.print(Panel("\n".join(lines), box=box.ROUNDED, border_style=style, padding=(0, 2)))

    # -- notices -------------------------------------------------------
    def notice(self, text: str, level: str = "info") -> None:
        self.console.print(f"[{_LEVEL_STYLE.get(level, 'dim')}]{text}[/]")

    def duress_alert(self) -> None:
        self.console.print(
            Panel(
                "[bold red]DURESS PHRASE DETECTED[/]\n"
                "Call was ended normally — no reaction shown on the line.\n"
                "Engaging [bold]silent escalation[/]: the worker will not be re-contacted.",
                border_style="red",
                box=box.HEAVY,
                padding=(0, 2),
            )
        )

    def report_written(self, path: str) -> None:
        self.console.print(f"\n[bold]Incident brief written:[/] [cyan]{path}[/]")

    def closing(self, text: str, good: bool) -> None:
        style = "green" if good else "red"
        self.console.print()
        self.console.print(Panel(f"[bold {style}]{text}[/]", box=box.ROUNDED, border_style=style, padding=(0, 2)))

    def timeline(self, events: list[tuple[str, str, str]]) -> None:
        table = Table(box=box.SIMPLE, show_header=True, header_style="dim")
        table.add_column("time", style="bold", no_wrap=True)
        table.add_column("event")
        for at, label, level in events:
            table.add_row(at, Text(label, style=_LEVEL_STYLE.get(level, "")))
        self.console.print(table)


class QuietRenderer(RichRenderer):
    """Renderer that swallows output (tests / machine runs)."""

    def __init__(self) -> None:
        super().__init__(console=Console(quiet=True))
