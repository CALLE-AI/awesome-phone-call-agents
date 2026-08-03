import html
import io
import json
import re
import sys

from reportlab.lib import colors
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.graphics.shapes import Drawing, Rect
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def text(value):
    return html.escape(str(value or "")).replace("\n", "<br/>")


def timestamp(seconds):
    if not isinstance(seconds, (int, float)):
        return ""
    total = max(0, round(seconds))
    return f"{total // 60:02d}:{total % 60:02d}"


def speaker_name(speaker):
    return {"bot": "MedRoute AI", "user": "Pharmacy staff"}.get(speaker, "Caller")


def clean_turn_text(value):
    return re.sub(r"\s+", " ", re.sub(r"^\s*\d+\.\s+", "", str(value or ""))).strip()


def sentence_complete(value):
    return bool(re.search(r"[.!?][\"')\]]?\s*$", value))


def merge_transcript_turns(turns):
    merged = []
    for source in turns:
        turn = dict(source)
        turn["text"] = clean_turn_text(turn.get("text"))
        if not turn["text"]:
            continue
        previous = merged[-1] if merged else None
        if previous and previous.get("speaker") == turn.get("speaker") and not sentence_complete(previous.get("text", "")):
            previous["text"] = f"{previous['text']} {turn['text']}"
        else:
            merged.append(turn)
    return merged


def add_footer(canvas, document):
    canvas.saveState()
    canvas.setStrokeColor(HexColor("#DCE7F4"))
    canvas.line(18 * mm, 15 * mm, A4[0] - 18 * mm, 15 * mm)
    canvas.setFillColor(HexColor("#587093"))
    canvas.setFont("Helvetica", 8)
    canvas.drawString(18 * mm, 10 * mm, "MedRoute - pharmacy availability transcript")
    canvas.drawRightString(A4[0] - 18 * mm, 10 * mm, f"Page {document.page}")
    canvas.restoreState()


def medroute_logo():
    logo = Drawing(13 * mm, 13 * mm)
    logo.add(Rect(0, 0, 13 * mm, 13 * mm, rx=3 * mm, ry=3 * mm, fillColor=HexColor("#1D5FD3"), strokeColor=None))
    logo.add(Rect(5.2 * mm, 2.7 * mm, 2.6 * mm, 7.6 * mm, fillColor=colors.white, strokeColor=None))
    logo.add(Rect(2.7 * mm, 5.2 * mm, 7.6 * mm, 2.6 * mm, fillColor=colors.white, strokeColor=None))
    return logo


def build_pdf(payload):
    output = io.BytesIO()
    document = SimpleDocTemplate(
        output,
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=22 * mm,
        title="MedRoute call transcript",
        author="MedRoute",
    )
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "TranscriptTitle",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=22,
        leading=26,
        textColor=HexColor("#123F9A"),
        spaceAfter=5,
    )
    label_style = ParagraphStyle(
        "Label",
        parent=styles["BodyText"],
        fontName="Helvetica-Bold",
        fontSize=8,
        leading=10,
        textColor=HexColor("#5A7294"),
        uppercase=True,
    )
    value_style = ParagraphStyle(
        "Value",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=10,
        leading=13,
        textColor=HexColor("#182A49"),
    )
    turn_style = ParagraphStyle(
        "Turn",
        parent=value_style,
        fontSize=10,
        leading=15,
    )
    agent_style = ParagraphStyle("AgentTurn", parent=turn_style, textColor=HexColor("#153D8C"))
    staff_style = ParagraphStyle("StaffTurn", parent=turn_style, textColor=HexColor("#243B5F"))

    brand_lockup = Table([[
        medroute_logo(),
        Paragraph("<b>MedRoute</b><br/><font color='#2F75D0' size='7'>CALL-E VOICE POWERED</font>", ParagraphStyle("BrandLockup", parent=value_style, fontSize=15, leading=16, textColor=HexColor("#102C62")))
    ]], colWidths=[15 * mm, 65 * mm], hAlign="LEFT")
    brand_lockup.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story = [
        brand_lockup,
        Spacer(1, 5 * mm),
        Paragraph("Call transcript", title_style),
        Paragraph("Availability check record", ParagraphStyle("Subtitle", parent=value_style, textColor=HexColor("#6A7F9E"))),
        Spacer(1, 8 * mm),
    ]

    details = [
        [Paragraph("PHARMACY", label_style), Paragraph("MEDICINE", label_style)],
        [Paragraph(text(payload.get("pharmacy")), value_style), Paragraph(text(payload.get("medicine")), value_style)],
        [Paragraph("PHONE", label_style), Paragraph("STRENGTH / FORM", label_style)],
        [Paragraph(text(payload.get("phone")), value_style), Paragraph(text(payload.get("strength") or "Not specified"), value_style)],
        [Paragraph("CHECK COMPLETED", label_style), Paragraph("CALL REFERENCE", label_style)],
        [Paragraph(text(payload.get("createdAt")), value_style), Paragraph(text(payload.get("callId") or "Not available"), value_style)],
    ]
    details_table = Table(details, colWidths=[87 * mm, 87 * mm], hAlign="LEFT")
    details_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), HexColor("#F7FAFF")),
        ("BOX", (0, 0), (-1, -1), 0.6, HexColor("#DCE7F4")),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, HexColor("#E5EDF7")),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story += [details_table, Spacer(1, 7 * mm)]

    if payload.get("summary"):
        summary = Table([[Paragraph("CALL SUMMARY", label_style)], [Paragraph(text(payload["summary"]), value_style)]], colWidths=[174 * mm])
        summary.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), HexColor("#EDF6FF")),
            ("BOX", (0, 0), (-1, -1), 0.6, HexColor("#C9DFF8")),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ("TOPPADDING", (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ]))
        story += [summary, Spacer(1, 8 * mm)]

    story.append(Paragraph("Conversation", ParagraphStyle("ConversationHeading", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=15, leading=19, textColor=HexColor("#17376D"), spaceAfter=7)))

    for turn in merge_transcript_turns(payload.get("transcript", [])):
        is_agent = turn.get("speaker") == "bot"
        header = f"{speaker_name(turn.get('speaker'))}{' - ' + timestamp(turn.get('offsetSeconds')) if timestamp(turn.get('offsetSeconds')) else ''}"
        block = Table([
            [Paragraph(text(header), ParagraphStyle("TurnHeader", parent=label_style, textColor=HexColor("#2F75D0") if is_agent else HexColor("#596E8D")))],
            [Paragraph(text(turn.get("text")), agent_style if is_agent else staff_style)],
        ], colWidths=[174 * mm])
        block.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), HexColor("#F2F7FF") if is_agent else colors.white),
            ("BOX", (0, 0), (-1, -1), 0.5, HexColor("#D5E4F5")),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ("TOPPADDING", (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ]))
        story += [KeepTogether(block), Spacer(1, 4 * mm)]

    story += [Spacer(1, 4 * mm), Paragraph("This transcript records an automated availability check only. MedRoute does not place orders, reserve medicine, or provide medical advice.", ParagraphStyle("Notice", parent=value_style, fontSize=8.5, leading=12, textColor=HexColor("#637894")))]
    document.build(story, onFirstPage=add_footer, onLaterPages=add_footer)
    return output.getvalue()


if __name__ == "__main__":
    payload = json.load(sys.stdin)
    sys.stdout.buffer.write(build_pdf(payload))
