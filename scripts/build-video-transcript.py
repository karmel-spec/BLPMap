#!/usr/bin/env python3
"""Build data/training/video-transcript[.es].json from the training-video SRTs.

Reads data/training/store-map-training.en.srt (and .es.srt when present) and
produces readable in-app transcript docs for the 🎓 Training viewer: one
section per ~5 minutes (titled with its time range), cues merged into
paragraphs at natural pauses.

Usage:  python3 scripts/build-video-transcript.py
"""
import json, os, re, html, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = os.path.join(ROOT, "data", "training")
VIDEO = "https://youtu.be/1zDlnks5CC0"
SECTION_SECONDS = 300
PAUSE_GAP = 1.5


def parse_srt(path):
    cues, block = [], []
    for line in open(path, encoding="utf-8").read().splitlines() + [""]:
        if line.strip():
            block.append(line)
            continue
        if len(block) >= 3:
            m = re.match(r"(\d+):(\d+):(\d+)[,.](\d+) --> (\d+):(\d+):(\d+)[,.](\d+)", block[1])
            g = [int(x) for x in m.groups()]
            cues.append({
                "start": g[0] * 3600 + g[1] * 60 + g[2] + g[3] / 1000,
                "end": g[4] * 3600 + g[5] * 60 + g[6] + g[7] / 1000,
                "text": " ".join(block[2:]).strip(),
            })
        block = []
    return cues


def mmss(t):
    m, s = divmod(int(t), 60)
    h, m = divmod(m, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def build(lang):
    suffix = ".es" if lang == "es" else ""
    src = os.path.join(DIR, f"store-map-training.{lang}.srt")
    if not os.path.exists(src):
        print(f"skip {lang}: {src} not found")
        return
    cues = parse_srt(src)
    sections = []
    i = 0
    while i < len(cues):
        sec_start = cues[i]["start"]
        limit = sec_start + SECTION_SECONDS
        paras, para = [], []
        while i < len(cues) and (cues[i]["start"] < limit or not paras and not para):
            if para and cues[i]["start"] - para[-1]["end"] > PAUSE_GAP and sum(len(c["text"]) for c in para) > 200:
                paras.append(para)
                para = []
            para.append(cues[i])
            i += 1
        if para:
            paras.append(para)
        sec_end = paras[-1][-1]["end"]
        html_out = "".join(
            "<p>" + html.escape(" ".join(c["text"] for c in p)) + "</p>" for p in paras)
        sections.append({
            "slug": f"t-{int(sec_start)}",
            "title": f"{mmss(sec_start)} – {mmss(sec_end)}",
            "html": html_out,
        })
    title = ("Video de Capacitación — Transcripción" if lang == "es"
             else "Training Video — Transcript")
    out = {
        "generated": datetime.date.today().isoformat(),
        "source": VIDEO,
        "lang": lang,
        "title": title,
        "sections": sections,
    }
    path = os.path.join(DIR, f"video-transcript{suffix}.json")
    json.dump(out, open(path, "w"), ensure_ascii=False)
    print(f"video-transcript{suffix}.json: {len(sections)} sections, {len(cues)} cues")


if __name__ == "__main__":
    build("en")
    build("es")
