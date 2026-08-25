#!/usr/bin/env python3
"""Build data/training/*.json for the 🎓 Training in-app doc viewer.

Two jobs:
  1. GUIDE  — fetch the Store Map User Guide Google Doc (export?format=html),
     clean it into {slug, title, html} sections, write data/training/guide.json.
     NOTE: guide.es.json (the Spanish translation) is hand-maintained — rerunning
     this script does NOT regenerate it; retranslate when the doc changes.
  2. SNAPSHOT — copy handbook + policies JSON (EN & ES) from the BLPShop repo
     (~/BLPShop/data/), rewriting relative asset paths to absolute
     https://blpshop.netlify.app/ URLs so images load from the shop app's deploy.

Usage:  python3 scripts/build-training-docs.py
"""
import json, os, re, html, urllib.request, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "data", "training")
GUIDE_DOC_ID = "1aq3oTa6pxr6AhquS7pbJakAY4q4iPc_nUJW4yLMXDOM"
GUIDE_URL = f"https://docs.google.com/document/d/{GUIDE_DOC_ID}/export?format=html"
BLPSHOP_DATA = os.path.expanduser("~/BLPShop/data")
BLPSHOP_BASE = "https://blpshop.netlify.app/"


def slugify(t):
    return re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-")[:40] or "s"


def bold_classes(head):
    """Class names whose CSS rule sets font-weight:700."""
    out = set()
    for m in re.finditer(r"\.([\w]+)\{[^}]*font-weight:700[^}]*\}", head):
        out.add(m.group(1))
    return out


def span_text(span_html, bold_cls):
    m = re.match(r'<span class="([^"]*)"[^>]*>(.*)</span>', span_html, re.S)
    if not m:
        return re.sub(r"<[^>]+>", "", span_html)
    classes, inner = set(m.group(1).split()), m.group(2)
    inner = re.sub(r"<[^>]+>", "", inner)
    if not inner.strip():
        return inner
    return f"<b>{inner}</b>" if classes & bold_cls else inner


def clean_block(block, bold_cls):
    """One <p>/<li> body -> plain text with <b> kept, adjacent bolds merged."""
    parts = [span_text(s, bold_cls) for s in re.findall(r"<span[^>]*>.*?</span>", block, re.S)]
    txt = "".join(parts)
    txt = txt.replace("</b><b>", "")
    return txt.strip()


def build_guide():
    raw = urllib.request.urlopen(GUIDE_URL, timeout=30).read().decode("utf-8")
    head = raw.split("</head>")[0]
    bold = bold_classes(head)
    body = re.search(r"<body[^>]*>(.*)</body>", raw, re.S).group(1)

    doc_title, sections, cur = "", [], None
    # walk top-level blocks in order
    for m in re.finditer(r"<(h1|h2|p|ul|ol)[^>]*>(.*?)</\1>", body, re.S):
        tag, inner = m.group(1), m.group(2)
        if tag == "h1":
            doc_title = html.unescape(re.sub(r"<[^>]+>", "", inner)).strip()
            continue
        if tag == "h2":
            title = html.unescape(re.sub(r"<[^>]+>", "", inner)).strip()
            cur = {"slug": slugify(title), "title": title, "html": ""}
            sections.append(cur)
            continue
        if cur is None:  # intro before first h2 -> its own section
            cur = {"slug": "intro", "title": "", "html": ""}
            sections.append(cur)
        if tag in ("ul", "ol"):
            items = [clean_block(li, bold) for li in re.findall(r"<li[^>]*>(.*?)</li>", inner, re.S)]
            items = [i for i in items if i]
            if items:
                cur["html"] += f"<{tag}>" + "".join(f"<li>{i}</li>" for i in items) + f"</{tag}>"
        else:
            t = clean_block(inner, bold)
            if t:
                cur["html"] += f"<p>{t}</p>"

    out = {
        "generated": datetime.date.today().isoformat(),
        "source": f"https://docs.google.com/document/d/{GUIDE_DOC_ID}/edit",
        "lang": "en",
        "title": doc_title,
        "sections": [s for s in sections if s["html"]],
    }
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, "guide.json")
    json.dump(out, open(path, "w"), ensure_ascii=False, indent=1)
    print(f"guide.json: {len(out['sections'])} sections, title {doc_title!r}")


def snapshot(name):
    for suffix in ("", ".es"):
        src = os.path.join(BLPSHOP_DATA, f"{name}{suffix}.json")
        d = json.load(open(src))
        for s in d["sections"]:
            s["html"] = s["html"].replace('src="assets/', f'src="{BLPSHOP_BASE}assets/')
        d["snapshotted"] = datetime.date.today().isoformat()
        d["snapshotFrom"] = "~/BLPShop/data (rerun scripts/build-training-docs.py to refresh)"
        path = os.path.join(OUT_DIR, f"{name}{suffix}.json")
        json.dump(d, open(path, "w"), ensure_ascii=False)
        print(f"{name}{suffix}.json: {len(d['sections'])} sections")


if __name__ == "__main__":
    build_guide()
    snapshot("handbook")
    snapshot("policies")
