#!/usr/bin/env python3
"""Build Surge's bounded runtime search index from the controlled PDF library."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re

from pypdf import PdfReader


SOURCE_ROOT = Path(
    os.environ.get("SURGE_ASSESSOR_EDUCATION_SOURCE_ROOT", Path.home() / "Downloads")
).resolve()
REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = REPOSITORY_ROOT / "src" / "data" / "surge-industry-library.generated.json"

SOURCES = (
    {
        "id": "electric-saul-editorial",
        "title": "Electric Saul",
        "file": "electric saul.pdf",
        "pages": 10,
        "sha256": "48260e86e921a25b4e468ed93a3b6ed754137f2c1d0c70df3addd4667aecd32c",
    },
    {
        "id": "home-by-evidence",
        "title": "Home by Evidence: Australian Home Design and Retrofit Guide",
        "file": "Evidence_Led_Australian_Home_Design_and_Retrofit_Guide.pdf",
        "pages": 103,
        "sha256": "5c53df499119c53780e19fd286b30979a45d52370f367503b091bc2d183e2f6b",
    },
    {
        "id": "drive-the-transition",
        "title": "Drive the Transition: Australian Electric Mobility Guide",
        "file": "Electric_Mobility_Australian_EV_and_Transport_Transition_Guide.pdf",
        "pages": 86,
        "sha256": "3fa876bd416c2e365d975fdb9453253af980a5d4e87d5e89a2289ebbbce78613",
    },
    {
        "id": "comfort-by-design",
        "title": "Comfort by Design: Australian Insulation and Glazing Guide",
        "file": "Comfort_Envelope_Australian_Insulation_and_Glazing_Guide.pdf",
        "pages": 73,
        "sha256": "b3512edd99f057bba18a8268c1eb63769d1043acb819a278f3100b39996852d9",
    },
    {
        "id": "power-you-control",
        "title": "Power You Control: Australian Home Energy Systems Guide",
        "file": "Power_You_Control_Australian_Home_Energy_Guide.pdf",
        "pages": 124,
        "sha256": "c11f7035e911d58b47a0f67ce202d7f4c270c2826184ada518738b1bce856bf8",
    },
    {
        "id": "comfort-you-control",
        "title": "Comfort You Control: Australian Renter and Homeowner Field Guide",
        "file": "Comfort_You_Control_Australian_Home_Handbook.pdf",
        "pages": 62,
        "sha256": "359bc82a6d549b5653ed13eee9a087ac08aaf24055c42030b1933c996b9fca63",
    },
    {
        "id": "community-informed-response-guide",
        "title": "Community-Informed Home Energy AI Response Guide",
        "file": "meeh-community-ai-response-guide.pdf",
        "pages": 7,
        "sha256": "ce8c8b570251840d819fbac8f342afc3f42d89077833eb114fd0429006ac7b85",
    },
)

MAX_CHUNK_CHARS = 900
OVERLAP_SENTENCES = 2


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def clean_text(value: str) -> str:
    value = value.replace("\u00ad", "")
    value = re.sub(r"[\u2010-\u2015\u2212]", "-", value)
    value = re.sub(r"(?<=\w)-\s*\n\s*(?=\w)", "", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def split_long_sentence(sentence: str) -> list[str]:
    if len(sentence) <= MAX_CHUNK_CHARS:
        return [sentence]
    words = sentence.split()
    pieces: list[str] = []
    current: list[str] = []
    current_length = 0
    for word in words:
        next_length = current_length + len(word) + (1 if current else 0)
        if current and next_length > MAX_CHUNK_CHARS:
            pieces.append(" ".join(current))
            current = [word]
            current_length = len(word)
        else:
            current.append(word)
            current_length = next_length
    if current:
        pieces.append(" ".join(current))
    return pieces


def page_chunks(page_text: str) -> list[str]:
    cleaned = clean_text(page_text)
    if len(cleaned) < 80:
        return []
    sentences = [
        piece.strip()
        for sentence in re.split(r"(?<=[.!?])\s+(?=[A-Z0-9])", cleaned)
        for piece in split_long_sentence(sentence.strip())
        if piece.strip()
    ]
    chunks: list[str] = []
    current: list[str] = []
    for sentence in sentences:
        candidate = " ".join([*current, sentence])
        if current and len(candidate) > MAX_CHUNK_CHARS:
            chunks.append(" ".join(current))
            current = [*current[-OVERLAP_SENTENCES:], sentence]
            while len(" ".join(current)) > MAX_CHUNK_CHARS and len(current) > 1:
                current.pop(0)
        else:
            current.append(sentence)
    if current:
        tail = " ".join(current)
        if len(tail) >= 80 and (not chunks or tail != chunks[-1]):
            chunks.append(tail)
    return chunks


def main() -> None:
    records: list[dict[str, object]] = []
    source_records: list[dict[str, object]] = []
    for source in SOURCES:
        path = SOURCE_ROOT / str(source["file"])
        if not path.is_file():
            raise SystemExit(f"Controlled PDF is unavailable: {path}")
        actual_sha = sha256(path)
        if actual_sha != source["sha256"]:
            raise SystemExit(f"Controlled PDF SHA-256 mismatch: {path.name}")
        reader = PdfReader(path)
        if len(reader.pages) != source["pages"]:
            raise SystemExit(f"Controlled PDF page-count mismatch: {path.name}")
        source_chunk_count = 0
        for page_number, page in enumerate(reader.pages, start=1):
            for page_chunk_number, text in enumerate(page_chunks(page.extract_text() or ""), start=1):
                records.append({
                    "id": f"{source['id']}-p{page_number}-c{page_chunk_number}",
                    "sourceId": source["id"],
                    "sourceTitle": source["title"],
                    "page": page_number,
                    "text": text,
                })
                source_chunk_count += 1
        source_records.append({
            "id": source["id"],
            "title": source["title"],
            "pageCount": source["pages"],
            "pdfSha256": source["sha256"],
            "chunkCount": source_chunk_count,
        })

    payload = {
        "schemaVersion": 1,
        "classification": "editorial_primary",
        "currentFactBoundary": "verify_with_current_official_sources",
        "sourceCount": len(source_records),
        "pageCount": sum(int(source["pageCount"]) for source in source_records),
        "chunkCount": len(records),
        "sources": source_records,
        "chunks": records,
    }
    OUTPUT_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(
        f"Generated {len(records)} bounded passages from "
        f"{len(source_records)} PDFs and {payload['pageCount']} pages: {OUTPUT_PATH}"
    )


if __name__ == "__main__":
    main()
