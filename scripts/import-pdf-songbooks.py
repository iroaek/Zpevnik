from __future__ import annotations

import csv
import hashlib
import json
import re
import sys
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from pypdf import PdfReader


ROOT = Path.cwd().resolve()
INPUT_ROOT = (ROOT / "songs_data").resolve()
NORMALIZED_ROOT = (ROOT / "data" / "normalized").resolve()
FOOTER_MARKERS = ("pisnicky-akordy.cz", "srovnavac.cz")


def ensure_inside(path: Path, parent: Path) -> None:
    try:
        path.relative_to(parent)
    except ValueError as error:
        raise RuntimeError(f"Nebezpečná cesta mimo povolený adresář: {path}") from error


def fold(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value)
    return "".join(char for char in decomposed if not unicodedata.combining(char)).lower()


def normalized_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", fold(value))


def clean_text(value: str) -> str:
    value = unicodedata.normalize("NFC", value.replace("\r\n", "\n").replace("\r", "\n"))
    value = "".join(char for char in value if char in "\n\t" or unicodedata.category(char) not in {"Cc", "Cf"})
    lines: list[str] = []
    blank = False
    for raw_line in value.splitlines():
        line = raw_line.rstrip().replace("\u00a0", " ")
        folded = fold(line)
        if any(marker in folded for marker in FOOTER_MARKERS):
            continue
        if not line.strip():
            if not blank and lines:
                lines.append("")
            blank = True
            continue
        blank = False
        lines.append(line)
    cleaned = "\n".join(lines).strip()
    return f"{cleaned}\n" if cleaned else ""


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", fold(value)).strip("-")
    return slug[:80] or "bez-nazvu"


def extract_header(page: object) -> tuple[str, str]:
    chunks: list[dict[str, object]] = []
    width = float(page.mediabox.width)  # type: ignore[attr-defined]
    height = float(page.mediabox.height)  # type: ignore[attr-defined]

    def visitor(text: str, _cm: list[float], tm: list[float], font: object, font_size: float) -> None:
        value = text.strip()
        if not value:
            return
        base_font = str(font.get("/BaseFont", "")) if font else ""  # type: ignore[union-attr]
        chunks.append({"text": value, "size": float(font_size), "x": float(tm[4]), "y": float(tm[5]), "font": base_font})

    page.extract_text(visitor_text=visitor)  # type: ignore[attr-defined]
    title_candidates = [chunk for chunk in chunks if float(chunk["size"]) >= 15.5 and float(chunk["y"]) > height * 0.68]
    if not title_candidates:
        return "", ""
    title_line = max(float(chunk["y"]) for chunk in title_candidates)
    title = " ".join(
        str(chunk["text"])
        for chunk in sorted((chunk for chunk in title_candidates if abs(float(chunk["y"]) - title_line) < 2.5), key=lambda chunk: float(chunk["x"]))
    ).strip()
    artist_candidates = [
        chunk for chunk in chunks
        if 10.5 <= float(chunk["size"]) < 15.5
        and height * 0.68 < float(chunk["y"]) < title_line
        and float(chunk["x"]) > width * 0.48
        and "bold" in str(chunk["font"]).lower()
    ]
    artist = ""
    if artist_candidates:
        artist_line = max(float(chunk["y"]) for chunk in artist_candidates)
        artist = " ".join(
            str(chunk["text"])
            for chunk in sorted((chunk for chunk in artist_candidates if abs(float(chunk["y"]) - artist_line) < 2.5), key=lambda chunk: float(chunk["x"]))
        ).strip()
    return unicodedata.normalize("NFC", title), unicodedata.normalize("NFC", artist or "Neuvedený interpret")


def compact_content_key(text: str, title: str, artist: str) -> str:
    body = text
    for prefix in (title, artist):
        body = body.replace(prefix, "", 1)
    compact = re.sub(r"\s+", " ", fold(body)).strip()
    return hashlib.sha256(compact.encode("utf-8")).hexdigest()


def group_records(records: list[dict[str, object]], field: str, prefix: str) -> list[dict[str, object]]:
    grouped: dict[str, list[dict[str, object]]] = defaultdict(list)
    for record in records:
        key = str(record[field])
        if key:
            grouped[key].append(record)
    groups: list[dict[str, object]] = []
    for members in grouped.values():
        if len(members) < 2:
            continue
        group_id = f"{prefix}-{len(groups) + 1:04d}"
        groups.append({
            "id": group_id,
            "title": members[0]["title"],
            "members": [member["sourceIdentifier"] for member in members],
        })
        for member in members:
            duplicate_groups = member.setdefault("duplicateGroups", [])
            assert isinstance(duplicate_groups, list)
            duplicate_groups.append(group_id)
    return groups


def main() -> int:
    ensure_inside(INPUT_ROOT, ROOT)
    ensure_inside(NORMALIZED_ROOT, ROOT)
    pdf_paths = sorted(INPUT_ROOT.glob("*.pdf"))
    if not pdf_paths:
        raise RuntimeError("V songs_data nebyly nalezeny žádné PDF soubory.")

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S-%fZ")
    output_root = NORMALIZED_ROOT / f"import-{stamp}-pdf-songbooks"
    drafts_root = output_root / "requires-review" / "pages"
    output_root.mkdir(parents=True, exist_ok=False)
    drafts_root.mkdir(parents=True, exist_ok=True)

    records: list[dict[str, object]] = []
    issues: list[dict[str, object]] = []
    for pdf_path in pdf_paths:
        ensure_inside(pdf_path.resolve(), INPUT_ROOT)
        reader = PdfReader(str(pdf_path))
        previous_song: dict[str, str] | None = None
        for page_index, reader_page in enumerate(reader.pages, start=1):
                try:
                    raw_text = reader_page.extract_text(extraction_mode="layout") or ""
                    cleaned = clean_text(raw_text)
                    extracted_title, extracted_artist = extract_header(reader_page)
                except Exception as error:  # A single damaged page must not stop the audit.
                    cleaned = ""
                    extracted_title = ""
                    extracted_artist = ""
                    issues.append({"file": pdf_path.name, "page": page_index, "message": str(error)})

                if not cleaned.strip():
                    page_type = "blank"
                    title = f"Prázdná strana {page_index}"
                    artist = "Neuvedený interpret"
                    parent_candidate = None
                elif not extracted_title:
                    page_type = "continuation_candidate"
                    title = f"Pokračování: {previous_song['title']}" if previous_song else f"Nepřiřazené pokračování {page_index}"
                    artist = previous_song["artist"] if previous_song else "Neuvedený interpret"
                    parent_candidate = previous_song["sourceIdentifier"] if previous_song else None
                else:
                    page_type = "song_start"
                    title = extracted_title
                    artist = extracted_artist
                    parent_candidate = None

                record_id = f"{slugify(title)}-{pdf_path.stem}-p{page_index:03d}"
                draft_relative = Path("requires-review") / "pages" / f"{record_id}.txt"
                draft_path = output_root / draft_relative
                ensure_inside(draft_path.resolve(), output_root)
                draft_path.write_text(cleaned, encoding="utf-8", newline="\n")
                source_identifier = f"songs_data/{pdf_path.name}#page={page_index}"
                if page_type == "song_start":
                    previous_song = {"title": title, "artist": artist, "sourceIdentifier": source_identifier}
                records.append({
                    "id": record_id,
                    "title": title,
                    "artist": artist,
                    "source": f"Uživatelem dodané PDF {pdf_path.name}; dokument uvádí původ pisnicky-akordy.cz",
                    "sourceIdentifier": source_identifier,
                    "rightsStatus": "requires_review",
                    "license": "UNVERIFIED - personal-use source supplied by user",
                    "attribution": artist,
                    "status": "requires_manual_review",
                    "pageType": page_type,
                    "parentCandidate": parent_candidate,
                    "draftPath": draft_relative.as_posix(),
                    "textCharacters": len(cleaned),
                    "titleKey": normalized_key(title) if page_type == "song_start" else "",
                    "titleArtistKey": f"{normalized_key(title)}::{normalized_key(artist)}" if page_type == "song_start" else "",
                    "contentKey": compact_content_key(cleaned, title, artist) if page_type != "blank" else "",
                    "duplicateGroups": [],
                    "transformations": [
                        "PDF page text extracted in layout mode",
                        "Unicode normalized to NFC",
                        "control characters removed",
                        "source-site footer removed from draft",
                    ],
                })

    exact_groups = group_records(records, "contentKey", "exact")
    title_artist_groups = group_records(records, "titleArtistKey", "title-artist")
    title_groups = group_records(records, "titleKey", "title")

    public_records = []
    for record in records:
        public_records.append({key: value for key, value in record.items() if key not in {"contentKey", "titleKey", "titleArtistKey"}})

    created_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    song_starts = sum(record["pageType"] == "song_start" for record in records)
    continuation_pages = sum(record["pageType"] == "continuation_candidate" for record in records)
    blank_pages = sum(record["pageType"] == "blank" for record in records)
    report = {
        "schemaVersion": 1,
        "createdAt": created_at,
        "inputFiles": [path.relative_to(ROOT).as_posix() for path in pdf_paths],
        "totals": {
            "pdfFiles": len(pdf_paths),
            "pages": len(records),
            "songStarts": song_starts,
            "continuationCandidates": continuation_pages,
            "blankPages": blank_pages,
            "publishable": 0,
            "requiresManualReview": len(records),
            "extractionIssues": len(issues),
            "exactDuplicateGroups": len(exact_groups),
            "sameTitleAndArtistGroups": len(title_artist_groups),
            "sameTitleGroups": len(title_groups),
        },
        "publicationBlocked": True,
        "publicationReason": "Práva a licence nejsou ověřené; všechny záznamy zůstávají mimo veřejný katalog.",
        "issues": issues,
    }
    (output_root / "import-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output_root / "manual-review.json").write_text(json.dumps({"records": public_records}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output_root / "duplicate-report.json").write_text(json.dumps({
        "exactContent": exact_groups,
        "sameTitleAndArtist": title_artist_groups,
        "sameTitle": title_groups,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with (output_root / "duplicate-report.csv").open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(["duplicate_group", "title", "source_identifier"])
        for group in exact_groups + title_artist_groups + title_groups:
            for source_identifier in group["members"]:
                writer.writerow([group["id"], group["title"], source_identifier])
    with (output_root / "audit-log.jsonl").open("w", encoding="utf-8", newline="\n") as stream:
        for record in public_records:
            stream.write(json.dumps({
                "timestamp": created_at,
                "origin": record["sourceIdentifier"],
                "recordId": record["id"],
                "status": record["status"],
                "transformations": record["transformations"],
            }, ensure_ascii=False) + "\n")
    (output_root / "README.md").write_text(
        "# PDF import - pouze ke kontrole\n\n"
        "Zdrojové soubory v `songs_data` nebyly změněny. Každá strana byla vyextrahována do `requires-review/pages` "
        "a označena `requires_review`. Žádná píseň nebyla přidána do `data/songs` ani `public/content`.\n\n"
        "Duplicitní skupiny jsou pouze kandidáti ke kontrole; skript je automaticky neslučuje. "
        "Před zařazením je nutné ověřit titul, interpreta, rozložení akordů, zdroj, oprávnění a licenci.\n",
        encoding="utf-8",
    )

    print(f"PDF import dokončen: {len(pdf_paths)} soubory, {len(records)} stran; {song_starts} začátků písní, {continuation_pages} pokračování, {blank_pages} prázdných stran.")
    print(f"Přesné skupiny duplicit: {len(exact_groups)}; stejné tituly/interpreti: {len(title_artist_groups)}; stejné tituly: {len(title_groups)}.")
    print(f"Výstup: {output_root.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"Chyba PDF importu: {error}", file=sys.stderr)
        raise
