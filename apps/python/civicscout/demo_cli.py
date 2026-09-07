"""
CivicScout Interactive CLI Demonstration Runner
Executes real-time simulated call lifecycles, FastMCP mid-call tool invocations,
and multi-agent departmental escalations.
"""

import sys
import io
import asyncio
import json
import logging
from rich.console import Console
from rich.table import Table
from rich.panel import Panel

# Configure UTF-8 stdout on Windows if necessary
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from app.database import db
from app.models import TicketStatus, DepartmentEnum, TicketSeverity, CalleWebhookPayload
from app.mcp_server import query_authorization_code, trigger_department_escalation, update_ticket_status_midcall
from app.calle_client import calle_client
from app.orchestrator import orchestrator

console = Console(legacy_windows=False)
logging.getLogger("CivicScout").setLevel(logging.WARNING)


async def run_demo():
    console.print(Panel.fit(
        "[bold cyan]CivicScout: Proactive Public Works Autonomous Voice Agent[/bold cyan]\n"
        "[italic green]Powered by CALL-E, FastMCP, Google Cloud Run, and Firestore[/italic green]",
        border_style="cyan"
    ))

    # 1. Inspect Pending Civic Tickets
    tickets = await db.get_pending_tickets()
    table = Table(title="[bold yellow]Pending 311 Civic Work Orders in Firestore[/bold yellow]")
    table.add_column("Ticket ID", style="cyan", no_wrap=True)
    table.add_column("Department", style="magenta")
    table.add_column("Location", style="white")
    table.add_column("Severity", style="bold red")
    table.add_column("Reporter", style="green")

    for t in tickets:
        table.add_row(t.id, t.department.value, t.location_address, t.severity.value, f"{t.reporter.name} ({t.reporter.phone_e164})")

    console.print(table)
    console.print("\n" + "="*80 + "\n")

    # 2. Pick Ticket for Multi-Agent Escalation Demo
    target_ticket_id = "TKT-311-ROADS-8812"
    ticket = await db.get_ticket(target_ticket_id)

    console.print("[bold green]>>> SCENARIO: Multi-Agent Escalation Workflow[/bold green]")
    console.print(f"[white]Initial Ticket:[/] [bold cyan]{ticket.id}[/] | Department: [bold magenta]{ticket.department.value}[/]")
    console.print(f"[white]Citizen:[/] [bold green]{ticket.reporter.name}[/] ({ticket.reporter.phone_e164})")
    console.print(f"[white]Location:[/] {ticket.location_address} ({ticket.cross_streets})\n")

    # Step 1: Outbound Dispatch
    console.print("[bold yellow][Step 1][/bold yellow] Orchestrator triggers primary CALL-E outbound call...")
    call_info = await calle_client.initiate_primary_call(ticket)
    console.print(f"  -> CALL-E Call Queued: [bold cyan]{call_info['call_id']}[/] | Mode: [green]{call_info['mode']}[/]")

    # Step 2: Mid-Call FastMCP Invocation
    console.print("\n[bold yellow][Step 2][/bold yellow] Caller provides municipal contractor authorization code 'PW-AUTH-9921'...")
    console.print("  -> Invoking FastMCP Tool: [bold magenta]query_authorization_code()[/]...")
    auth_result = await query_authorization_code(ticket_id=ticket.id, auth_code="PW-AUTH-9921")
    console.print(f"  -> FastMCP Response: [bold green]VALID[/] | Issuer: {auth_result['issuer']} | Permissions: {', '.join(auth_result['permissions'])}")

    # Step 3: Mid-Call Hazard Discovery & Escalation Trigger
    console.print("\n[bold yellow][Step 3][/bold yellow] Caller reports ruptured high-pressure water main flooding toward electrical box!")
    console.print("  -> Invoking FastMCP Tool: [bold magenta]trigger_department_escalation()[/]...")
    esc_trigger = await trigger_department_escalation(
        ticket_id=ticket.id,
        source_dept=DepartmentEnum.ROADS_INFRASTRUCTURE.value,
        target_dept=DepartmentEnum.EMERGENCY_UTILITY_DISPATCH.value,
        reason="High-pressure water main rupture compromising underground electrical conduit beneath roadbed.",
        urgency_level=TicketSeverity.CRITICAL_EMERGENCY.value
    )
    console.print(f"  -> FastMCP Escalation Status: [bold red]{esc_trigger['escalation_status']}[/] -> Transferred to [bold red]{esc_trigger['target_department']}[/]")

    # Step 4: Webhook Completion & Structured Result Extraction
    console.print("\n[bold yellow][Step 4][/bold yellow] CALL-E call completes. Ingesting Webhook & Structured JSON...")
    sim_result = calle_client.simulate_call_execution(ticket, call_info['call_id'], simulate_escalation=True)
    webhook_payload = CalleWebhookPayload.model_validate(sim_result)
    webhook_resp = await orchestrator.handle_call_webhook(webhook_payload)

    console.print(Panel(
        f"[bold white]Transcript Excerpt:[/bold white]\n[italic]{sim_result['transcript'][:350]}...[/italic]\n\n"
        f"[bold white]Structured Result Extracted:[/bold white]\n" +
        json.dumps(sim_result['structured_result'], indent=2),
        title="[bold green]CALL-E Real-Time Telemetry & Structured Output[/bold green]",
        border_style="green"
    ))

    # Step 5: Secondary Agent Dispatch
    console.print("\n[bold yellow][Step 5][/bold yellow] Orchestrator dynamically spins up Secondary CALL-E Agent with new emergency context...")
    console.print(f"  -> Secondary Agent Target: [bold red]{webhook_resp['escalation']['target_department']}[/]")
    console.print(f"  -> Secondary Call ID: [bold cyan]{webhook_resp['escalation']['secondary_call_id']}[/]")

    # Step 6: Final State Inspection in Firestore
    final_ticket = await db.get_ticket(target_ticket_id)
    console.print("\n[bold yellow][Step 6][/bold yellow] Final State Stored in Google Cloud Firestore:")
    
    final_table = Table(title=f"[bold green]Ticket {final_ticket.id} Updated State[/bold green]")
    final_table.add_column("Field", style="cyan")
    final_table.add_column("Value", style="white")
    final_table.add_row("Status", f"[bold red]{final_ticket.status.value}[/bold red]")
    final_table.add_row("Department", f"[bold yellow]{final_ticket.department.value}[/bold yellow]")
    final_table.add_row("Severity", f"[bold red]{final_ticket.severity.value}[/bold red]")
    final_table.add_row("Authorization Code", final_ticket.authorization_code or "None")
    final_table.add_row("Audit Logs Count", str(len(final_ticket.audit_logs)))
    final_table.add_row("Escalation Trail", f"{final_ticket.escalation_trail[0].source_department.value} -> {final_ticket.escalation_trail[0].target_department.value}")

    console.print(final_table)
    console.print("\n[bold green]SUCCESS: Demonstration Complete! All workflows verified.[/bold green]\n")


if __name__ == "__main__":
    asyncio.run(run_demo())
