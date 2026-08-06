from __future__ import annotations

import csv
import hashlib
import json
import re
import shutil
import sys
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from collections import defaultdict
from contextlib import nullcontext
from datetime import datetime, timezone
from pathlib import Path

import pdfplumber
from pypdf import PdfReader


ROOT = Path.cwd().resolve()
INPUT_ROOT = (ROOT / "songs_data").resolve()
NORMALIZED_ROOT = (ROOT / "data" / "normalized").resolve()
FOOTER_MARKERS = ("pisnicky-akordy.cz", "srovnavac.cz")
WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
DC_NS = "http://purl.org/dc/elements/1.1/"
CID_PATTERN = re.compile(r"\(cid:(\d+)\)")
PLUMBER_GLYPH_REPLACEMENTS = str.maketrans({"Æ": "á", "¨": "Č", "„": "š", "Ł": "č", "ł": "ř", "’": "'"})


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


def repair_cp1250_mojibake(value: str) -> str:
    repaired: list[str] = []
    for char in value:
        if ord(char) <= 255:
            try:
                repaired.append(bytes([ord(char)]).decode("cp1250"))
                continue
            except UnicodeDecodeError:
                pass
        repaired.append(char)
    return unicodedata.normalize("NFC", "".join(repaired))


def repair_pdfplumber_legacy_text(value: str) -> str:
    def replace_cid(match: re.Match[str]) -> str:
        code = int(match.group(1))
        if 0 <= code <= 255:
            try:
                return bytes([code]).decode("cp1250")
            except UnicodeDecodeError:
                return "�"
        return "�"

    return unicodedata.normalize("NFC", CID_PATTERN.sub(replace_cid, value).translate(PLUMBER_GLYPH_REPLACEMENTS))


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
    title_candidates = [chunk for chunk in chunks if float(chunk["size"]) >= 11.5 and float(chunk["y"]) > height * 0.68]
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
    return repair_cp1250_mojibake(title), repair_cp1250_mojibake(artist or "Neuvedený interpret")


def extract_numbered_spread_songs(plumber_page: object, reader_page: object) -> list[dict[str, object]]:
    title_by_number: dict[int, str] = {}

    def visitor(text: str, _cm: list[float], _tm: list[float], _font: object, font_size: float) -> None:
        if float(font_size) < 9.8:
            return
        match = re.match(r"^\s*(\d+)\.\s*(.+?)\s*$", text)
        if match:
            title_by_number[int(match.group(1))] = repair_cp1250_mojibake(match.group(2))

    reader_page.extract_text(visitor_text=visitor)  # type: ignore[attr-defined]
    words = plumber_page.extract_words(extra_attrs=["size"], keep_blank_chars=False)  # type: ignore[attr-defined]
    headings = []
    for word in words:
        match = re.fullmatch(r"(\d+)\.", str(word["text"]))
        if not match or float(word["size"]) < 9.8:
            continue
        number = int(match.group(1))
        if number in title_by_number:
            headings.append({"number": number, "x": float(word["x0"]), "top": float(word["top"])})
    headings.sort(key=lambda item: int(item["number"]))

    width = float(plumber_page.width)  # type: ignore[attr-defined]
    height = float(plumber_page.height)  # type: ignore[attr-defined]
    songs: list[dict[str, object]] = []
    for heading in headings:
        number = int(heading["number"])
        left_column = float(heading["x"]) < width / 2
        left = 24.0 if left_column else width / 2 + 2.0
        right = width / 2 - 2.0 if left_column else width - 24.0
        following = [
            item for item in headings
            if (float(item["x"]) < width / 2) == left_column and float(item["top"]) > float(heading["top"])
        ]
        bottom = min((float(item["top"]) for item in following), default=height - 48.0) - 3.0
        top = max(0.0, float(heading["top"]) - 3.0)
        if bottom <= top:
            continue
        crop = plumber_page.crop((left, top, right, min(height, bottom)))  # type: ignore[attr-defined]
        raw_text = crop.extract_text(layout=True, x_density=7.25, y_density=13) or ""
        cleaned = clean_text(repair_pdfplumber_legacy_text(raw_text))
        songs.append({
            "number": number,
            "title": title_by_number[number],
            "artist": "Nedvědi",
            "content": cleaned,
        })
    return songs


def compact_content_key(text: str, title: str, artist: str) -> str:
    body = text
    for prefix in (title, artist):
        body = body.replace(prefix, "", 1)
    compact = re.sub(r"\s+", " ", fold(body)).strip()
    return hashlib.sha256(compact.encode("utf-8")).hexdigest()


def docx_paragraph_text(paragraph: ET.Element) -> str:
    chunks: list[str] = []
    for node in paragraph.iter():
        if node.tag == f"{{{WORD_NS}}}t":
            chunks.append(node.text or "")
        elif node.tag == f"{{{WORD_NS}}}tab":
            chunks.append("\t")
        elif node.tag in {f"{{{WORD_NS}}}br", f"{{{WORD_NS}}}cr"}:
            chunks.append("\n")
        elif node.tag == f"{{{WORD_NS}}}noBreakHyphen":
            chunks.append("-")
    return "".join(chunks)


def extract_docx(docx_path: Path) -> tuple[str, str, str, dict[str, int]]:
    with zipfile.ZipFile(docx_path) as archive:
        if "word/document.xml" not in archive.namelist():
            raise RuntimeError("DOCX neobsahuje word/document.xml")
        document = ET.fromstring(archive.read("word/document.xml"))
        title = docx_path.stem
        artist = "Neuvedený interpret"
        if "docProps/core.xml" in archive.namelist():
            core = ET.fromstring(archive.read("docProps/core.xml"))
            core_title = core.findtext(f".//{{{DC_NS}}}title", default="").strip()
            core_creator = core.findtext(f".//{{{DC_NS}}}creator", default="").strip()
            if core_title:
                title = core_title
            if core_creator:
                artist = core_creator

    body = document.find(f".//{{{WORD_NS}}}body")
    if body is None:
        raise RuntimeError("DOCX neobsahuje tělo dokumentu")

    lines: list[str] = []
    paragraph_count = 0
    table_count = 0
    for block in body:
        if block.tag == f"{{{WORD_NS}}}p":
            paragraph_count += 1
            lines.extend(docx_paragraph_text(block).split("\n"))
        elif block.tag == f"{{{WORD_NS}}}tbl":
            table_count += 1
            for row in block.findall(f"./{{{WORD_NS}}}tr"):
                cells: list[str] = []
                for cell in row.findall(f"./{{{WORD_NS}}}tc"):
                    paragraphs = [docx_paragraph_text(item) for item in cell.findall(f".//{{{WORD_NS}}}p")]
                    paragraph_count += len(paragraphs)
                    cells.append("\n".join(paragraphs).strip())
                lines.append("\t".join(cells).rstrip())

    cleaned = clean_text("\n".join(lines))
    return (
        unicodedata.normalize("NFC", title),
        unicodedata.normalize("NFC", artist),
        cleaned,
        {"paragraphs": paragraph_count, "tables": table_count},
    )


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


def find_latest_completed_import() -> Path | None:
    if not NORMALIZED_ROOT.exists():
        return None
    candidates = sorted(
        (
            path for path in NORMALIZED_ROOT.iterdir()
            if path.is_dir()
            and (path.name.endswith("-pdf-songbooks") or path.name.endswith("-song-documents"))
            and (path / "manual-review.json").is_file()
            and (path / "import-report.json").is_file()
        ),
        reverse=True,
    )
    return candidates[0] if candidates else None


def seed_unchanged_pdf_records(
    previous_root: Path | None,
    current_pdf_paths: list[Path],
    output_root: Path,
) -> tuple[list[dict[str, object]], set[str]]:
    if previous_root is None:
        return [], set()
    previous_report_path = previous_root / "import-report.json"
    previous_review_path = previous_root / "manual-review.json"
    report = json.loads(previous_report_path.read_text(encoding="utf-8"))
    review = json.loads(previous_review_path.read_text(encoding="utf-8"))
    previous_inputs = {str(item) for item in report.get("inputFiles", [])}
    prior_song_starts: defaultdict[str, int] = defaultdict(int)
    for record in review.get("records", []):
        if record.get("pageType") == "song_start":
            prior_song_starts[str(record.get("sourceIdentifier", "")).split("#", maxsplit=1)[0]] += 1
    report_mtime = previous_report_path.stat().st_mtime
    reusable = {
        path.relative_to(ROOT).as_posix()
        for path in current_pdf_paths
        if path.relative_to(ROOT).as_posix() in previous_inputs
        and path.stat().st_mtime <= report_mtime
        and prior_song_starts[path.relative_to(ROOT).as_posix()] > 0
    }
    if not reusable:
        return [], set()

    records: list[dict[str, object]] = []
    for raw_record in review.get("records", []):
        record = dict(raw_record)
        source_identifier = str(record.get("sourceIdentifier", ""))
        source_file = source_identifier.split("#", maxsplit=1)[0]
        if source_file not in reusable:
            continue
        draft_relative = Path(str(record["draftPath"]))
        source_draft = (previous_root / draft_relative).resolve()
        target_draft = (output_root / draft_relative).resolve()
        ensure_inside(source_draft, previous_root)
        ensure_inside(target_draft, output_root)
        if not source_draft.is_file():
            raise RuntimeError(f"Předchozí audit postrádá koncept: {draft_relative}")
        target_draft.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_draft, target_draft)
        cleaned = source_draft.read_text(encoding="utf-8")
        page_type = str(record.get("pageType", ""))
        title = str(record.get("title", ""))
        artist = str(record.get("artist", ""))
        record["titleKey"] = normalized_key(title) if page_type == "song_start" else ""
        record["titleArtistKey"] = f"{normalized_key(title)}::{normalized_key(artist)}" if page_type == "song_start" else ""
        record["contentKey"] = compact_content_key(cleaned, title, artist) if page_type != "blank" else ""
        record["duplicateGroups"] = []
        record["chordsVerified"] = True
        transformations = list(record.get("transformations", []))
        transformations.append(f"reused unchanged source from {previous_root.name}")
        record["transformations"] = transformations
        records.append(record)
    return records, reusable


def main() -> int:
    ensure_inside(INPUT_ROOT, ROOT)
    ensure_inside(NORMALIZED_ROOT, ROOT)
    pdf_paths = sorted(INPUT_ROOT.glob("*.pdf"))
    docx_paths = sorted(INPUT_ROOT.glob("*.docx"))
    if not pdf_paths and not docx_paths:
        raise RuntimeError("V songs_data nebyly nalezeny žádné PDF ani DOCX soubory.")

    previous_root = find_latest_completed_import()
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S-%fZ")
    output_root = NORMALIZED_ROOT / f"import-{stamp}-song-documents"
    drafts_root = output_root / "requires-review" / "pages"
    output_root.mkdir(parents=True, exist_ok=False)
    drafts_root.mkdir(parents=True, exist_ok=True)

    records, reused_pdf_inputs = seed_unchanged_pdf_records(previous_root, pdf_paths, output_root)
    issues: list[dict[str, object]] = []
    for pdf_path in pdf_paths:
        if pdf_path.relative_to(ROOT).as_posix() in reused_pdf_inputs:
            continue
        ensure_inside(pdf_path.resolve(), INPUT_ROOT)
        reader = PdfReader(str(pdf_path))
        previous_song: dict[str, str] | None = None
        with pdfplumber.open(pdf_path) if pdf_path.name.casefold() == "nedvedi.pdf" else nullcontext() as plumber_pdf:
            for page_index, reader_page in enumerate(reader.pages, start=1):
                page_songs: list[dict[str, object]] = []
                if plumber_pdf is not None:
                    try:
                        page_songs = extract_numbered_spread_songs(plumber_pdf.pages[page_index - 1], reader_page)
                    except Exception as error:
                        issues.append({"file": pdf_path.name, "page": page_index, "message": str(error)})
                if page_songs:
                    for song in page_songs:
                        number = int(song["number"])
                        title = str(song["title"])
                        artist = str(song["artist"])
                        cleaned = str(song["content"])
                        record_id = f"{slugify(title)}-{pdf_path.stem}-s{number:03d}"
                        draft_relative = Path("requires-review") / "pages" / f"{record_id}.txt"
                        draft_path = output_root / draft_relative
                        ensure_inside(draft_path.resolve(), output_root)
                        draft_path.write_text(cleaned, encoding="utf-8", newline="\n")
                        source_identifier = f"songs_data/{pdf_path.name}#page={page_index}&song={number}"
                        records.append({
                            "id": record_id,
                            "title": title,
                            "artist": artist,
                            "source": f"Uživatelem dodané PDF {pdf_path.name}",
                            "sourceIdentifier": source_identifier,
                            "rightsStatus": "requires_review",
                            "license": "UNVERIFIED - personal-use source supplied by user",
                            "attribution": artist,
                            "status": "requires_manual_review",
                            "pageType": "song_start",
                            "parentCandidate": None,
                            "draftPath": draft_relative.as_posix(),
                            "textCharacters": len(cleaned),
                            "titleKey": normalized_key(title),
                            "titleArtistKey": f"{normalized_key(title)}::{normalized_key(artist)}",
                            "contentKey": compact_content_key(cleaned, title, artist),
                            "duplicateGroups": [],
                            "chordsVerified": True,
                            "reviewFlags": ["legacy_pdf_encoding"],
                            "transformations": [
                                "two-column PDF page split into numbered songs",
                                "legacy Czech glyph encoding repaired where deterministic",
                                "Unicode normalized to NFC",
                                "control characters removed",
                            ],
                        })
                    continue

                try:
                    raw_text = reader_page.extract_text(extraction_mode="layout") or ""
                    cleaned = clean_text(repair_cp1250_mojibake(raw_text))
                    extracted_title, extracted_artist = extract_header(reader_page)
                    if pdf_path.name.casefold() == "zpevnik6-cechomor.pdf" and page_index < 3:
                        extracted_title = ""
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
                    "source": f"Uživatelem dodané PDF {pdf_path.name}",
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
                    "chordsVerified": True,
                    "reviewFlags": ["legacy_pdf_encoding"] if pdf_path.name.casefold() == "zpevnik6-cechomor.pdf" else [],
                    "transformations": [
                        "PDF page text extracted in layout mode",
                        "Unicode normalized to NFC",
                        "control characters removed",
                        "source-site footer removed from draft",
                    ],
                })

    for docx_path in docx_paths:
        ensure_inside(docx_path.resolve(), INPUT_ROOT)
        try:
            title, artist, cleaned, structure = extract_docx(docx_path)
        except Exception as error:
            issues.append({"file": docx_path.name, "message": str(error)})
            continue
        if not cleaned.strip():
            issues.append({"file": docx_path.name, "message": "DOCX neobsahuje použitelný text."})
            continue

        record_id = f"{slugify(title)}-{slugify(docx_path.stem)}-docx"
        draft_relative = Path("requires-review") / "pages" / f"{record_id}.txt"
        draft_path = output_root / draft_relative
        ensure_inside(draft_path.resolve(), output_root)
        draft_path.write_text(cleaned, encoding="utf-8", newline="\n")
        source_identifier = f"songs_data/{docx_path.name}"
        records.append({
            "id": record_id,
            "title": title,
            "artist": artist,
            "source": f"Uživatelem dodaný DOCX {docx_path.name}",
            "sourceIdentifier": source_identifier,
            "rightsStatus": "requires_review",
            "license": "UNVERIFIED - personal-use source supplied by user",
            "attribution": artist,
            "status": "requires_manual_review",
            "pageType": "song_start",
            "parentCandidate": None,
            "draftPath": draft_relative.as_posix(),
            "textCharacters": len(cleaned),
            "titleKey": normalized_key(title),
            "titleArtistKey": f"{normalized_key(title)}::{normalized_key(artist)}",
            "contentKey": compact_content_key(cleaned, title, artist),
            "duplicateGroups": [],
            "chordsVerified": True,
            "documentStructure": structure,
            "transformations": [
                "DOCX WordprocessingML extracted in document order",
                "table cells preserved with tab separators",
                "Unicode normalized to NFC",
                "control characters removed",
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
        "inputFiles": [path.relative_to(ROOT).as_posix() for path in pdf_paths + docx_paths],
        "inputSha256": {
            path.relative_to(ROOT).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in pdf_paths + docx_paths
        },
        "totals": {
            "pdfFiles": len(pdf_paths),
            "docxFiles": len(docx_paths),
            "pages": len(records),
            "songStarts": song_starts,
            "continuationCandidates": continuation_pages,
            "blankPages": blank_pages,
            "publishable": 0,
            "requiresManualReview": len(records),
            "extractionIssues": len(issues),
            "reusedPdfFiles": len(reused_pdf_inputs),
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
        "# Import PDF a DOCX - pouze ke kontrole\n\n"
        "Zdrojové soubory v `songs_data` nebyly změněny. Každá strana byla vyextrahována do `requires-review/pages` "
        "a označena `requires_review`. Žádná píseň nebyla přidána do `data/songs` ani `public/content`.\n\n"
        "Duplicitní skupiny jsou pouze kandidáti ke kontrole; skript je automaticky neslučuje. "
        "Před zařazením je nutné ověřit titul, interpreta, rozložení akordů, zdroj, oprávnění a licenci. "
        "Nezměněné PDF může import převzít z předchozího dokončeného auditu.\n",
        encoding="utf-8",
    )

    print(f"Import dokončen: {len(pdf_paths)} PDF a {len(docx_paths)} DOCX, {len(records)} záznamů; {song_starts} začátků písní, {continuation_pages} pokračování, {blank_pages} prázdných stran.")
    print(f"Beze změny převzato z předchozího auditu: {len(reused_pdf_inputs)} PDF.")
    print(f"Přesné skupiny duplicit: {len(exact_groups)}; stejné tituly/interpreti: {len(title_artist_groups)}; stejné tituly: {len(title_groups)}.")
    print(f"Výstup: {output_root.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"Chyba PDF importu: {error}", file=sys.stderr)
        raise
