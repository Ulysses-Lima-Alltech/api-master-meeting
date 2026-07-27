"""MCP prompts — the 4 workflow prompts ported from 0.10.6 ``services/mcp/main.py``.

Edits from the source are ONLY where a referenced tool did not survive the port
(see the service README, "not yet ported"): meeting_prep no longer instructs
``update_meeting_data`` (no PATCH /meetings route in the 0.12 public API yet) and
post_meeting composes ``get_meeting_transcript`` + ``list_recordings`` instead of
the skipped ``get_meeting_bundle``/share-link tools.
"""
from __future__ import annotations

from typing import Dict, Optional

import mcp.types as mcp_types

PROMPTS: Dict[str, mcp_types.Prompt] = {
    "vexa.meeting_prep": mcp_types.Prompt(
        name="vexa.meeting_prep",
        title="Vexa: Meeting Prep",
        description="Parse link and request the meeting bot.",
        arguments=[
            mcp_types.PromptArgument(
                name="meeting_url",
                description="Full meeting URL (recommended for Teams/Zoom).",
                required=False,
            ),
            mcp_types.PromptArgument(
                name="meeting_platform",
                description="google_meet | teams | zoom (optional if meeting_url is provided).",
                required=False,
            ),
            mcp_types.PromptArgument(
                name="meeting_id",
                description="Native meeting ID (optional if meeting_url is provided).",
                required=False,
            ),
            mcp_types.PromptArgument(
                name="notes",
                description="Optional notes/agenda/context for the meeting.",
                required=False,
            ),
        ],
    ),
    "vexa.during_meeting": mcp_types.Prompt(
        name="vexa.during_meeting",
        title="Vexa: During Meeting",
        description="Check bot status and retrieve current transcript snapshot.",
        arguments=[
            mcp_types.PromptArgument(name="meeting_platform", description="google_meet | teams | zoom", required=True),
            mcp_types.PromptArgument(name="meeting_id", description="Native meeting ID", required=True),
        ],
    ),
    "vexa.post_meeting": mcp_types.Prompt(
        name="vexa.post_meeting",
        title="Vexa: Post Meeting",
        description="Fetch transcript + recordings and produce follow-ups.",
        arguments=[
            mcp_types.PromptArgument(name="meeting_platform", description="google_meet | teams | zoom", required=True),
            mcp_types.PromptArgument(name="meeting_id", description="Native meeting ID", required=True),
        ],
    ),
    "vexa.teams_link_help": mcp_types.Prompt(
        name="vexa.teams_link_help",
        title="Vexa: Teams Link Help",
        description="Supported Teams links and passcode requirements.",
        arguments=[
            mcp_types.PromptArgument(name="meeting_url", description="Teams meeting URL from the user", required=False),
        ],
    ),
    "vexa.sales_analysis": mcp_types.Prompt(
        name="vexa.sales_analysis",
        title="Vexa: Sales Analysis",
        description="Analyze meeting transcript for BANT/SPIN, objections, and risk flag, then save it.",
        arguments=[
            mcp_types.PromptArgument(name="meeting_platform", description="google_meet | teams | zoom", required=True),
            mcp_types.PromptArgument(name="meeting_id", description="Native meeting ID", required=True),
            mcp_types.PromptArgument(name="meeting_db_id", description="Numeric database ID of the meeting", required=True),
        ],
    ),
}


def get_prompt_result(name: str, arguments: Optional[Dict[str, str]] = None) -> mcp_types.GetPromptResult:
    args = arguments or {}

    def t(text: str) -> mcp_types.TextContent:
        return mcp_types.TextContent(type="text", text=text)

    if name == "vexa.meeting_prep":
        meeting_url = (args.get("meeting_url") or "").strip()
        meeting_platform = (args.get("meeting_platform") or "").strip()
        meeting_id = (args.get("meeting_id") or "").strip()
        notes = (args.get("notes") or "").strip()

        return mcp_types.GetPromptResult(
            description="Meeting prep flow using Vexa MCP tools.",
            messages=[
                mcp_types.PromptMessage(
                    role="user",
                    content=t(
                        "You are helping me prepare a meeting using Vexa.\n\n"
                        "Goals:\n"
                        "1. Identify meeting platform + native meeting id (+ passcode if needed).\n"
                        "2. Request the meeting bot (idempotent).\n\n"
                        "Rules:\n"
                        "- Prefer calling `parse_meeting_link` when `meeting_url` is provided.\n"
                        "- When requesting a bot, pass `meeting_url` if you have it; otherwise use "
                        "`native_meeting_id` (+ `passcode` for Teams, from ?p=).\n"
                        "- Keep any provided notes in the conversation for the post-meeting summary "
                        "(storing notes on the meeting record is not available via this MCP yet).\n\n"
                        f"Input:\n- meeting_url: {meeting_url or '(none)'}\n"
                        f"- meeting_platform: {meeting_platform or '(none)'}\n"
                        f"- meeting_id: {meeting_id or '(none)'}\n"
                        f"- notes: {notes or '(none)'}\n\n"
                        "Now do the tool calls and tell me what you did and what to do next."
                    ),
                )
            ],
        )

    if name == "vexa.during_meeting":
        meeting_platform = (args.get("meeting_platform") or "").strip()
        meeting_id = (args.get("meeting_id") or "").strip()
        return mcp_types.GetPromptResult(
            description="During-meeting helper prompt using Vexa MCP tools.",
            messages=[
                mcp_types.PromptMessage(
                    role="user",
                    content=t(
                        "You are my during-meeting assistant using Vexa.\n\n"
                        f"Meeting: platform={meeting_platform}, id={meeting_id}\n\n"
                        "Steps:\n"
                        "- Call `get_bot_status` to confirm the bot is active / requested.\n"
                        "- Call `get_meeting_transcript` to fetch the current transcript snapshot.\n"
                        "- If the transcript is empty, explain whether the meeting may not have started, "
                        "bot may not be admitted yet, or transcription isn't producing segments.\n\n"
                        "Then summarize key points and action items so far."
                    ),
                )
            ],
        )

    if name == "vexa.post_meeting":
        meeting_platform = (args.get("meeting_platform") or "").strip()
        meeting_id = (args.get("meeting_id") or "").strip()
        return mcp_types.GetPromptResult(
            description="Post-meeting helper prompt using Vexa MCP tools.",
            messages=[
                mcp_types.PromptMessage(
                    role="user",
                    content=t(
                        "You are my post-meeting assistant using Vexa.\n\n"
                        f"Meeting: platform={meeting_platform}, id={meeting_id}\n\n"
                        "Steps:\n"
                        "- Call `get_meeting_transcript` to fetch the meeting status, notes, and segments.\n"
                        "- Call `list_recordings` (optionally `get_recording`) if recordings are expected.\n"
                        "- Produce:\n"
                        "  1) concise summary\n"
                        "  2) decisions\n"
                        "  3) action items with owners (if known) and due dates (if mentioned)\n"
                        "  4) open questions\n"
                    ),
                )
            ],
        )

    if name == "vexa.teams_link_help":
        meeting_url = (args.get("meeting_url") or "").strip()
        return mcp_types.GetPromptResult(
            description="Teams link troubleshooting prompt.",
            messages=[
                mcp_types.PromptMessage(
                    role="user",
                    content=t(
                        "Help me troubleshoot a Microsoft Teams meeting link for Vexa.\n\n"
                        f"User link: {meeting_url or '(none provided)'}\n\n"
                        "Checklist:\n"
                        "- If link is `teams.live.com/meet/<id>?p=<passcode>`:\n"
                        "  - native_meeting_id = <id> (10-15 digits)\n"
                        "  - passcode = value of ?p= (often required)\n"
                        "  - Prefer using `meeting_url` directly with `request_meeting_bot`.\n"
                        "- Enterprise `teams.microsoft.com/meet/<id>?p=<passcode>` short links are supported; "
                        "legacy `/l/meetup-join/...` links are forwarded as raw URLs.\n"
                        "- If passcode fails validation, explain constraints (8-20 alphanumeric) and ask for a corrected link.\n\n"
                        "If a link is provided, call `parse_meeting_link` and show the extracted fields."
                    ),
                )
            ],
        )

    if name == "vexa.sales_analysis":
        meeting_platform = (args.get("meeting_platform") or "").strip()
        meeting_id = (args.get("meeting_id") or "").strip()
        meeting_db_id = (args.get("meeting_db_id") or "").strip()
        return mcp_types.GetPromptResult(
            description="Sales intelligence extraction prompt using Vexa MCP tools.",
            messages=[
                mcp_types.PromptMessage(
                    role="user",
                    content=t(
                        "You are an expert B2B Sales Analyst.\n\n"
                        f"Meeting: platform={meeting_platform}, id={meeting_id}\n\n"
                        "Steps:\n"
                        "- Call `get_meeting_transcript` to fetch the meeting transcript.\n"
                        "- Analyze the conversation using BANT/SPIN methodologies.\n"
                        "- Extract the following structured data:\n"
                        "  1) summary: 3-line executive summary.\n"
                        "  2) funnel_stage: Prospecting, Discovery, Proposal, or Negotiation.\n"
                        "  3) objections: list of objections raised (e.g. Price, Competitor, Timing).\n"
                        "  4) next_steps: clear action items.\n"
                        "  5) risk_flag: High, Medium, or Low (based on tone and engagement).\n"
                        f"- Finally, call `save_call_analysis` passing `meeting_db_id` = {meeting_db_id} and the extracted data."
                    ),
                )
            ],
        )

    raise ValueError(f"Unknown prompt: {name}")
