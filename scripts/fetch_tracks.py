#!/usr/bin/env python3
"""Snapshot the track definitions + tech specialties from the
"Sequence by Piano technician" spreadsheet into data/tracks.json.

Each `* track` tab: row 2 = that track's phase list (columns); rows 3+ are
concurrent tasks whose merged colored cell spans the phase columns during
which the task may run (must finish before the phase after the span ends).

The `tech specialties` tab: skill matrix (0=never..3=go-to expert) for team
members and subcontractors, plus the intern list and its guidelines note.

Rerun after Brigham edits the tabs, then commit:
    python3 scripts/fetch_tracks.py
"""
import json, os, re, subprocess, sys, datetime

SEQ_ID = "1k9ToAeueEg5WOtaY91xXzL-a0l_AJsSZWw23tcAWECU"
ACCOUNT = "karmel@brighamlarsonpianos.com"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "tracks.json")


def gog(*args):
    out = subprocess.run(["gog", "-a", ACCOUNT, "--json", "sheets", *args, SEQ_ID]
                         if args[0] == "info" else
                         ["gog", "-a", ACCOUNT, "--json", "sheets", args[0], SEQ_ID, *args[1:]],
                         capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit(f"gog {args[0]} failed: {out.stderr[:300]}")
    return json.loads(out.stdout)


def main():
    info = gog("info")
    tracks = {}
    for sh in info.get("sheets", []):
        props = sh.get("properties", {})
        title = props.get("title", "")
        if not title.endswith(" track"):
            continue
        vals = gog("get", f"'{title}'!A1:T30").get("values", [])
        phases = [c.strip() for c in (vals[1] if len(vals) > 1 else []) if c.strip()]
        merges = sh.get("merges", [])
        tasks = []
        for ri in range(2, len(vals)):
            row = vals[ri]
            name = next((c.strip() for c in row if c.strip()), "")
            if not name:
                continue
            namecol = next(i for i, c in enumerate(row) if c.strip())  # 0-based
            m = next((m for m in merges
                      if m["startRowIndex"] == ri and
                         m["startColumnIndex"] <= namecol < m["endColumnIndex"]), None)
            s = m["startColumnIndex"] if m else namecol       # 0-based col == phase idx
            e = (m["endColumnIndex"] - 1) if m else namecol
            e = min(e, len(phases) - 1)
            tasks.append({"name": name, "start": s, "end": e,
                          "startPhase": phases[s] if s < len(phases) else "",
                          "endPhase": phases[e] if e < len(phases) else ""})
        key = title[:-len(" track")].strip().lower()
        tracks[key] = {"phases": phases, "tasks": tasks}

    # tech specialties: header row 2 = skill areas; sections by A-column labels
    tv = gog("get", "'tech specialties'!A1:X40").get("values", [])
    areas = [c.strip() for c in (tv[1][1:] if len(tv) > 1 else []) if c.strip()]
    section = ""
    people = []
    for row in tv[2:]:
        a = (row[0] if row else "").strip()
        if not a:
            continue
        if a.lower() in ("team members", "subcontractors", "interns"):
            section = a.lower().rstrip("s")  # team member / subcontractor / intern
            continue
        ratings = {}
        for i, area in enumerate(areas):
            v = (row[i + 1] if len(row) > i + 1 else "").strip()
            if v.isdigit() and area.lower() != "versatility score":
                ratings[area] = int(v)
        people.append({"name": a, "role": section or "team member", "skills": ratings})

    notes = gog("notes", "'tech specialties'!A1:A40").get("notes", [])
    intern_note = next((n.get("note", "") for n in notes
                        if "intern" in (n.get("value", "") or "").lower()), "")

    out = {
        "generated": datetime.date.today().isoformat(),
        "source": f"https://docs.google.com/spreadsheets/d/{SEQ_ID}/edit",
        "tracks": tracks,
        "specialties": {"areas": areas, "people": people, "internNote": intern_note},
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"wrote {OUT}")
    for k, t in tracks.items():
        print(f"  {k:14s} {len(t['phases'])} phases, {len(t['tasks'])} tasks")
        for task in t["tasks"]:
            print(f"     · {task['name'][:44]:46s} {task['startPhase'][:18]} → {task['endPhase'][:18]}")
    print(f"  specialties: {len(people)} people, {len(areas)} areas, intern note: {len(intern_note)} chars")


if __name__ == "__main__":
    main()
