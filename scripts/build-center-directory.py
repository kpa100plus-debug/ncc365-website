#!/usr/bin/env python3
"""Build NCC center directory from the official MOIS KIKcd_H workbook."""

import argparse
import gzip
import json
from pathlib import Path

import openpyxl


def clean(value):
    return str(value).strip() if value is not None else ""


def build(source):
    workbook = openpyxl.load_workbook(source, read_only=True, data_only=True)
    sheet = workbook.active
    centers = []

    for row in sheet.iter_rows(min_row=2, values_only=True):
        official_code, province, municipality, local, created, retired = map(clean, row)
        if not official_code or retired:
            continue

        if local:
            level, prefix = "local", "L"
        elif official_code[2:] != "00000000":
            level, prefix = "municipality", "M"
        else:
            level, prefix = "province", "P"

        names = [name for name in (province, municipality, local) if name]
        centers.append(
            {
                "officialAdminCode": official_code,
                "provinceName": province,
                "municipalityName": municipality,
                "localName": local,
                "fullName": " ".join(names),
                "centerCode": f"NCC-{prefix}-{official_code}",
                "centerName": " ".join(names) + " 소비자센터",
                "level": level,
                "status": "reserved",
                "effectiveFrom": created,
            }
        )

    return centers


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--effective-date", default="2026-07-01")
    args = parser.parse_args()

    centers = build(args.source)
    payload = {
        "meta": {
            "source": "행정안전부 행정기관(행정동) 및 관할구역(법정동) 현황",
            "sourceFile": "jscode20260701.zip/KIKcd_H.20260701.xlsx",
            "effectiveDate": args.effective_date,
            "generatedDate": "2026-08-30",
            "reference": "REF-NCC-CENTER-AUTO-ASSIGN-20260830-01",
            "count": len(centers),
        },
        "centers": centers,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    serialized = (json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    if args.output.suffix == ".gz":
        args.output.write_bytes(gzip.compress(serialized, compresslevel=9, mtime=0))
    else:
        args.output.write_bytes(serialized)
    print(json.dumps(payload["meta"], ensure_ascii=False))


if __name__ == "__main__":
    main()
