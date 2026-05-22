#!/usr/bin/env python3
"""
export-session.py — converts a Claude Code JSONL transcript into a
clean, human-readable Markdown document suitable for sharing with
investors / YC / anyone curious how you actually work with AI.

It:
  • Reads the JSONL line by line (handles huge files)
  • Filters to a date range (default: last 48 hours)
  • Extracts only the actual conversation (user + assistant text)
  • Strips out tool calls, system reminders, file dumps, etc.
  • Outputs a tidy Markdown file ready for submission

Usage:
    python3 export-session.py
    python3 export-session.py --since 2026-05-10
    python3 export-session.py --output ~/Desktop/my-session.md
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# ----------------------- defaults -----------------------
DEFAULT_INPUT = Path.home() / ".claude/projects/-Users-a7medaldulaimi-Downloads-bas-udrus-project/d2e73eb5-e483-4178-bfb7-c1ad68dffa06.jsonl"
DEFAULT_OUTPUT = Path.home() / "Downloads/basudrus-claude-session.md"

# Patterns we strip from user messages because they're framework
# noise, not real user input.
SYSTEM_REMINDER_RE = re.compile(r"<system-reminder>.*?</system-reminder>", re.DOTALL)
CONTEXT_TAG_RE = re.compile(r"<command-(?:name|message|args|stdout|stderr)>.*?</command-[^>]+>", re.DOTALL)
LOCAL_CMD_RE = re.compile(r"<local-command-stdout>.*?</local-command-stdout>", re.DOTALL)
TOOL_RESULT_HEADER_RE = re.compile(r"Called the (?:Read|Bash|Edit|Write|Grep|Glob) tool with the following input:.*?(?=\n\n|\Z)", re.DOTALL)

def clean_user_text(text: str) -> str:
    """Remove framework wrappers from user messages."""
    text = SYSTEM_REMINDER_RE.sub("", text)
    text = CONTEXT_TAG_RE.sub("", text)
    text = LOCAL_CMD_RE.sub("", text)
    text = TOOL_RESULT_HEADER_RE.sub("", text)
    # Collapse excessive blank lines
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()

def is_framework_noise(role: str, text: str) -> bool:
    """Returns True if this message is system/framework noise we
    don't want in the human-readable export (compaction summaries,
    tool-call narration fragments, etc.)."""
    t = text.strip()
    if not t:
        return True
    if role == "user":
        # Compaction summary that gets re-injected at the start of a
        # continued session — not a real user message.
        if t.startswith("This session is being continued from a previous conversation"):
            return True
        if t.startswith("Caveat:") and len(t) < 200:
            return True
    if role == "assistant":
        # Short narration fragments between Edit/Write tool calls
        # ("Now update X to render Y:") aren't valuable to a YC reader.
        if len(t) < 120:
            return True
    return False

def extract_text_blocks(content) -> str:
    """Pull only the text content from a message — skip tool_use,
    tool_result, image blocks. Returns concatenated text or empty
    string if nothing useful."""
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    out_parts = []
    for block in content:
        if not isinstance(block, dict):
            continue
        btype = block.get("type")
        if btype == "text":
            out_parts.append(block.get("text", ""))
        # Deliberately skip tool_use, tool_result, image, etc.
    return "\n\n".join(p for p in out_parts if p.strip())

def parse_iso(ts: str) -> datetime:
    """Parse an ISO timestamp, returning UTC."""
    if not ts:
        return datetime(1970, 1, 1, tzinfo=timezone.utc)
    # Python <3.11 doesn't love 'Z' — replace.
    ts = ts.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(ts).astimezone(timezone.utc)
    except ValueError:
        return datetime(1970, 1, 1, tzinfo=timezone.utc)

def main():
    parser = argparse.ArgumentParser(description="Export Claude Code session to readable Markdown.")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT,
                        help="Path to JSONL session file.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT,
                        help="Where to write the Markdown.")
    parser.add_argument("--since", type=str, default=None,
                        help="Only include messages after this date (YYYY-MM-DD). Default: last 48 hours.")
    parser.add_argument("--all", action="store_true",
                        help="Include the entire history (warning: huge).")
    args = parser.parse_args()

    if not args.input.exists():
        print(f"ERROR: input file not found: {args.input}", file=sys.stderr)
        sys.exit(1)

    if args.all:
        since = datetime(1970, 1, 1, tzinfo=timezone.utc)
    elif args.since:
        since = datetime.fromisoformat(args.since).replace(tzinfo=timezone.utc)
    else:
        since = datetime.now(timezone.utc) - timedelta(hours=48)

    print(f"Reading: {args.input}")
    print(f"Filtering: messages since {since.isoformat()}")

    sections = []  # list of (timestamp, role, text)
    # Only dedupe msg_ids AFTER we successfully extracted text from
    # them — an assistant turn often spans multiple JSONL entries
    # with the same msg_id (tool_use first, final text later). If we
    # deduped on the first sighting we'd miss the text on the second.
    captured_msg_ids = set()
    n_total = 0
    n_kept = 0

    with args.input.open("r", encoding="utf-8", errors="replace") as f:
        for line in f:
            n_total += 1
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue

            ts = parse_iso(entry.get("timestamp", ""))
            if ts < since:
                continue

            etype = entry.get("type")
            msg = entry.get("message") or {}
            role = msg.get("role") or etype  # user/assistant

            if role not in ("user", "assistant"):
                continue

            # Dedupe only AFTER text capture (see comment above).
            mid = msg.get("id")
            if mid and mid in captured_msg_ids:
                continue

            text = extract_text_blocks(msg.get("content"))
            if not text:
                continue

            if role == "user":
                text = clean_user_text(text)
                if not text:
                    continue

            if is_framework_noise(role, text):
                continue

            if mid:
                captured_msg_ids.add(mid)
            sections.append((ts, role, text))
            n_kept += 1

    print(f"Scanned: {n_total} lines, kept {n_kept} messages.")

    # Sort by timestamp (should already be in order, but be safe)
    sections.sort(key=lambda x: x[0])

    # ----------------------- write markdown -----------------------
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as out:
        out.write("# Bas Udrus — Claude Code Session Transcript\n\n")
        out.write(f"**Founder:** Ahmed Al Dulaimi  \n")
        out.write(f"**Product:** Bas Udrus (basudrus.com) — AI study + mental health platform for Jordanian university students  \n")
        out.write(f"**Range:** {since.date()} → {datetime.now(timezone.utc).date()}  \n")
        out.write(f"**Messages:** {len(sections)}  \n\n")
        out.write("---\n\n")
        out.write("> This is a real, unedited transcript of how Ahmed works with Claude to build, ship, and strategize. ")
        out.write("Ahmed directs the build using AI tooling (Claude Code) — he makes the architecture, product, and ")
        out.write("business decisions; Claude implements the code.\n\n")
        out.write("---\n\n")

        for ts, role, text in sections:
            label = "🧑 **Ahmed:**" if role == "user" else "🤖 **Claude:**"
            out.write(f"### {label}  \n")
            out.write(f"_{ts.strftime('%Y-%m-%d %H:%M UTC')}_\n\n")
            out.write(text)
            out.write("\n\n---\n\n")

    size_kb = args.output.stat().st_size / 1024
    print(f"\n✓ Wrote: {args.output}")
    print(f"  Size: {size_kb:.1f} KB")
    print(f"  Messages: {len(sections)}")

if __name__ == "__main__":
    main()
