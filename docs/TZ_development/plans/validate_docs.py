"""Validate local planning documentation; does not test the application."""
from pathlib import Path
from urllib.parse import unquote
import hashlib
import json
import re

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]


def anchor(value):
    return re.sub(r"[^\w\- ]", "", value.lower()).replace(" ", "-")


def main():
    errors = []
    docs = sorted(HERE.glob("*.md"))
    plans = sorted(HERE.glob("2026-*.md"))
    if len(plans) != 11:
        errors.append("expected 11 plans")
    tasks = set()
    for plan in plans:
        content = plan.read_text(encoding="utf-8")
        for marker in ("Implementation Plan", "For agentic workers:", "**Goal:**", "**Architecture:**", "**Tech Stack:**", "**Spec:**", "## Global Constraints", "## Review Focus"):
            if marker not in content:
                errors.append(f"{plan.name}: missing {marker}")
        chunks = re.split(r"^### Task ([A-Z]\d+):[^\n]*", content, flags=re.M)
        for index in range(1, len(chunks), 2):
            task, body = chunks[index:index+2]
            if task in tasks:
                errors.append(f"duplicate task {task}")
            tasks.add(task)
            if "**Files:**" not in body or "**Interfaces:**" not in body or body.count("- [ ]") != 5:
                errors.append(f"{task}: expected Files/Interfaces and 5 steps")
    if len(tasks) != 31:
        errors.append("expected 31 tasks")
    for doc in docs:
        content = doc.read_text(encoding="utf-8")
        link_content = re.sub(r"`[^`\n]*`", "", content)
        for href in re.findall(r"\]\(([^)]+)\)", link_content):
            if re.match(r"[a-z]+://", href):
                continue
            local, _, fragment = unquote(href).partition("#")
            target = doc.parent / local if local else doc
            if not target.is_file():
                errors.append(f"{doc.name}: missing link {href}")
            elif fragment and target.suffix == ".md":
                headings = re.findall(r"^#+\s+(.+)$", target.read_text(encoding="utf-8"), re.M)
                if fragment not in {anchor(h) for h in headings}:
                    errors.append(f"{doc.name}: missing anchor {href}")
    ft_dir = ROOT / "Функциональные требования/v2.0"
    ft_ids = set()
    for path in ft_dir.glob("*.md"):
        ft_ids.update(re.findall(r"^### (FT-[A-Z]+-\d+)\.", path.read_text(encoding="utf-8"), re.M))
    for filename, regex, expected in (
        ("traceability.md", r"^\| (FT-[A-Z]+-\d+) \|", ft_ids),
        ("field-mapping.md", r"^\| ((?:CHK|VSE)-F\d{2}) \|", {f"{prefix}-F{n:02}" for prefix, count in (("CHK",44),("VSE",38)) for n in range(1,count+1)}),
        ("acceptance.md", r"^\| ((?:SC-\d{3}|AT-\d{2})) \|", {f"SC-{n:03}" for n in range(1,102)} | {f"AT-{n:02}" for n in range(1,26)}),
    ):
        ids = re.findall(regex, (HERE/filename).read_text(encoding="utf-8"), re.M)
        if set(ids) != expected or len(ids) != len(expected):
            errors.append(f"{filename}: coverage mismatch/duplicates")
    manifest = json.loads((HERE/"sources-manifest.json").read_text(encoding="utf-8"))
    for entry in manifest["files"]:
        path = ROOT / entry["path"]
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != entry["sha256"]:
            errors.append(f"source changed: {entry['path']}")
    print(json.dumps({"plans":len(plans),"tasks":len(tasks),"FT":len(ft_ids),"fields":82,"SC":101,"AT":25,"checked_markdown_files":len(docs),"errors":errors},ensure_ascii=False,indent=2))
    return bool(errors)


if __name__ == "__main__":
    raise SystemExit(main())
