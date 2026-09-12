#!/usr/bin/env python3
"""Import a person's Google Tasks (Gmail "Tasks" side panel) onto their Store Map task board,
one task = one card, into a dedicated column (default "Gmail Tasks").

Writes go straight to Supabase (the board's authority) so the column is set on insert and the
Apps Script bridge's per-card owner notifications never fire; the Sheet mirror ("Task Boards" +
"Board Columns" tabs) is appended via gog as karmel@ so both copies stay in step.

Dry-run by default. Usage:
  import_gmail_tasks.py --owner "Melissa Terry" --account melissa@brighamlarsonpianos.com [--client blp-tools] [--live]
  import_gmail_tasks.py --owner "Melissa Terry" --tasks-json tasks.json [--live]     # tasks already exported
Env: SUPABASE_URL + SUPABASE_SERVICE_KEY (read from ~/salesapp2/.env / .env.local if not set).
"""
import argparse, datetime, json, os, random, re, string, subprocess, sys, urllib.request

SHEET_ID = "11RoeVRETag5rZYX6_tEH-rf6x8JL0JeZU0P5AT0WI-I"
SHEET_ACCOUNT = "karmel@brighamlarsonpianos.com"

def load_env():
    for f in (os.path.expanduser("~/salesapp2/.env"), os.path.expanduser("~/salesapp2/.env.local")):
        if os.path.exists(f):
            for line in open(f):
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1); os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    if not os.environ.get("SUPABASE_URL") or not os.environ.get("SUPABASE_SERVICE_KEY"):
        sys.exit("SUPABASE_URL / SUPABASE_SERVICE_KEY not available")

def sb(path, method="GET", body=None, prefer="return=representation"):
    req = urllib.request.Request(os.environ["SUPABASE_URL"] + "/rest/v1/" + path, method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"apikey": os.environ["SUPABASE_SERVICE_KEY"], "Authorization": "Bearer " + os.environ["SUPABASE_SERVICE_KEY"],
                 "Content-Type": "application/json", "Prefer": prefer})
    with urllib.request.urlopen(req, timeout=20) as r:
        t = r.read().decode(); return json.loads(t) if t.strip() else None

def gog(*args):
    r = subprocess.run(["gog", *args, "--no-input", "-j"], capture_output=True, text=True)
    if r.returncode != 0: raise RuntimeError("gog failed: " + " ".join(args) + "\n" + r.stdout + r.stderr)
    return json.loads(r.stdout) if r.stdout.strip() else {}

def fetch_tasks(account, client):
    extra = ["--client", client] if client else []
    lists = gog("tasks", "lists", "list", "-a", account, *extra)
    lists = lists.get("tasklists") or lists.get("taskLists") or lists.get("items") or lists
    out = []
    for tl in lists:
        t = gog("tasks", "list", tl["id"], "-a", account, "--all", *extra)
        items = t.get("tasks") or t.get("items") or (t if isinstance(t, list) else [])
        for x in items:
            x["_list"] = tl.get("title", ""); out.append(x)
    return out

def new_card_id(): return "tc" + format(int(datetime.datetime.now().timestamp() * 1000), "x")[-8:] + str(random.randint(0, 9999))
def new_col_id(): return "cmt" + "".join(random.choice(string.ascii_lowercase + string.digits) for _ in range(6))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--owner", required=True); ap.add_argument("--account"); ap.add_argument("--client", default="")
    ap.add_argument("--tasks-json"); ap.add_argument("--col-label", default="Gmail Tasks"); ap.add_argument("--live", action="store_true")
    ap.add_argument("--include-completed", action="store_true")
    a = ap.parse_args(); load_env()
    owner = a.owner; owner_lc = owner.lower()

    tasks = json.load(open(a.tasks_json)) if a.tasks_json else fetch_tasks(a.account, a.client)
    if not a.include_completed: tasks = [t for t in tasks if (t.get("status") or "needsAction") != "completed"]
    tasks = [t for t in tasks if (t.get("title") or "").strip()]
    print(f"{len(tasks)} open Google Tasks for {owner}")

    # column: reuse if a column with this label already exists, else create
    rows = sb(f"tb_cols?owner=eq.{urllib.request.quote(owner_lc)}&select=owner,cols")
    cols = (rows[0]["cols"] if rows else [["todo", "TO DO"], ["doing", "DOING"], ["done", "DONE"]])
    col_id = next((c[0] for c in cols if c[1].strip().lower() == a.col_label.lower()), None)
    if not col_id:
        col_id = new_col_id(); new_cols = cols + [[col_id, a.col_label]]
        print(f"column '{a.col_label}' → new id {col_id}; cols become {new_cols}")
        if a.live:
            sb("tb_cols?on_conflict=owner", "POST", {"owner": owner_lc, "cols": new_cols}, prefer="resolution=merge-duplicates,return=minimal")
            # sheet mirror: Board Columns row
            bc = gog("sheets", "get", SHEET_ID, "Board Columns!A2:B100", "-a", SHEET_ACCOUNT)
            vals = (bc.get("values") or bc.get("valueRange", {}).get("values") or [])
            rownum = next((i + 2 for i, r in enumerate(vals) if r and r[0].strip().lower() == owner_lc), None)
            js = json.dumps(new_cols, separators=(",", ":"))
            if rownum: gog("sheets", "update", SHEET_ID, f"Board Columns!B{rownum}", "--values-json", json.dumps([[js]]), "-a", SHEET_ACCOUNT, "--input", "RAW")  # positional values split on commas — always pass JSON
            else: gog("sheets", "append", SHEET_ID, "Board Columns!A:B", "--values-json", json.dumps([[owner, js]]), "-a", SHEET_ACCOUNT, "--input", "RAW")
    else:
        print(f"column '{a.col_label}' already exists ({col_id})")

    # idempotency: skip tasks whose text already exists as an open card for this owner
    existing = sb(f"tb_cards?owner=eq.{urllib.request.quote(owner)}&select=text,col&done_at=is.null")
    have = {re.sub(r"\s+", " ", (c["text"] or "").strip().lower()) for c in existing}
    now = datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")
    made = []; skipped = 0; ord_ = 0
    for t in tasks:
        title = t["title"].strip(); notes = (t.get("notes") or "").strip()
        text = title + ("\n" + notes if notes else "")
        if len(text) > 2000: text = text[:1997] + "…"
        if re.sub(r"\s+", " ", text.lower()) in have or re.sub(r"\s+", " ", title.lower()) in have: skipped += 1; continue
        due = (t.get("due") or "")[:10]
        card = {"id": new_card_id(), "owner": owner, "col": col_id, "text": text, "serial": "", "due": due,
                "from_who": "Gmail Tasks import", "created": now, "updated_at": now, "ord": ord_}
        ord_ += 1; made.append(card)
        print(f"  {'ADD' if a.live else 'would add'}: {title[:70]}" + (f"  (due {due})" if due else "") + (f"  [{t.get('_list','')}]" if t.get("_list") else ""))
    if a.live and made:
        for i in range(0, len(made), 50): sb("tb_cards", "POST", made[i:i + 50], prefer="return=minimal")
        rows_sheet = [[c["id"], c["owner"], c["col"], c["text"], "", c["due"], c["from_who"], c["created"], "", c["ord"], "", ""] for c in made]
        gog("sheets", "append", SHEET_ID, "Task Boards!A:L", "--values-json", json.dumps(rows_sheet), "-a", SHEET_ACCOUNT, "--input", "RAW")
    print(f"{'Imported' if a.live else 'Would import'} {len(made)} cards into '{a.col_label}' ({col_id}); skipped {skipped} already on the board." + ("" if a.live else "  (dry run — add --live)"))

if __name__ == "__main__":
    main()
