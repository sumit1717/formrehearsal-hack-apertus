#!/usr/bin/env python3
"""Check current package bytes only, without importing or running product code.

The manifest is the sole explicit self-exclusion. This detects accidental byte
or inventory drift; it is not a signature, a release gate or a runtime test.
"""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys

MANIFEST = "PUBLIC_SOURCE_MANIFEST.v1.json"
SCHEMA = "formrehearsal-public-source-inventory-v1"
ENCODING = "sha256-of-utf8-json-sort-keys-compact-path-to-bytes-and-sha256"


class VerificationError(ValueError):
    """The candidate does not satisfy the current static inventory contract."""


def require(condition, message):
    if not condition:
        raise VerificationError(message)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "Duplicate JSON key: " + key)
        result[key] = value
    return result


def safe_name(name):
    require(isinstance(name, str) and bool(name), "Invalid inventory path")
    path = PurePosixPath(name)
    require(not path.is_absolute() and "\\" not in name and
            not any(part in {"", ".", ".."} for part in name.split("/")) and
            not any(ord(char) < 32 or ord(char) == 127 for char in name) and
            path.as_posix() == name, "Unsafe inventory path: " + name)
    return path


def inspect_tree(root):
    """Do not follow links, including a link used as the supplied root."""
    supplied = Path(os.path.abspath(os.fspath(root)))
    for ancestor in (supplied, *supplied.parents):
        require(not ancestor.is_symlink(), "Symbolic link in package root: " + str(ancestor))
    require(supplied.is_dir(), "Package root must be an existing directory")
    files, directories = {}, set()

    def visit(directory):
        with os.scandir(directory) as entries:
            for entry in sorted(entries, key=lambda item: item.name):
                path = Path(entry.path)
                name = path.relative_to(supplied).as_posix()
                safe_name(name)
                kind = entry.stat(follow_symlinks=False).st_mode
                if stat.S_ISDIR(kind):
                    directories.add(name)
                    visit(path)
                else:
                    require(stat.S_ISREG(kind), "Nonregular or symbolic-link entry: " + name)
                    files[name] = path

    visit(supplied)
    return files, directories


def check(root):
    files, directories = inspect_tree(root)
    require(MANIFEST in files, "Missing " + MANIFEST)
    manifest = json.loads(files[MANIFEST].read_text(encoding="utf-8"), object_pairs_hook=unique_object)
    require(isinstance(manifest, dict), "Manifest must be an object")
    require(set(manifest) == {"schema", "scope", "selfExcludedManifest", "inventoryEncoding",
                              "inventorySha256", "inventoriedFiles", "totalFiles", "files"},
            "Unexpected or missing manifest fields")
    require(manifest["schema"] == SCHEMA, "Unsupported manifest schema")
    require(manifest["scope"] == "public-release-static-bytes-only", "Unsupported verification scope")
    require(manifest["selfExcludedManifest"] == MANIFEST, "Only the named manifest may be self-excluded")
    require(manifest["inventoryEncoding"] == ENCODING, "Unsupported inventory encoding")
    expected = manifest["files"]
    require(isinstance(expected, dict) and bool(expected), "Empty or invalid file inventory")
    require(MANIFEST not in expected, "Manifest cannot hash itself")
    require(type(manifest["inventoriedFiles"]) is int and
            manifest["inventoriedFiles"] == len(expected), "Inventoried-file count mismatch")
    require(type(manifest["totalFiles"]) is int and
            manifest["totalFiles"] == len(expected) + 1, "Total-file count mismatch")
    for name, record in expected.items():
        safe_name(name)
        require(isinstance(record, dict) and set(record) == {"bytes", "sha256"},
                "Invalid file record: " + name)
        require(type(record["bytes"]) is int and record["bytes"] >= 0,
                "Invalid byte count: " + name)
        require(isinstance(record["sha256"], str) and
                re.fullmatch(r"[0-9a-f]{64}", record["sha256"]) is not None,
                "Invalid SHA-256: " + name)
    require(isinstance(manifest["inventorySha256"], str) and
            hashlib.sha256(canonical(expected)).hexdigest() == manifest["inventorySha256"],
            "Inventory digest mismatch")
    wanted = set(expected) | {MANIFEST}
    missing, extra = sorted(wanted - set(files)), sorted(set(files) - wanted)
    require(not missing and not extra,
            "File inventory differs; missing=" + repr(missing) + "; unexpected=" + repr(extra))
    wanted_directories = {parent.as_posix() for name in wanted
                          for parent in PurePosixPath(name).parents if parent.as_posix() != "."}
    require(directories == wanted_directories,
            "Directory inventory differs; unexpected=" + repr(sorted(directories - wanted_directories)))
    for name, record in expected.items():
        data = files[name].read_bytes()
        require(len(data) == record["bytes"] and hashlib.sha256(data).hexdigest() == record["sha256"],
                "Byte mismatch: " + name)
    return {
        "status": "PASS_PUBLIC_STATIC_SOURCE_BYTES",
        "inventoriedFiles": len(expected),
        "totalFiles": len(files),
        "selfExcludedManifest": MANIFEST,
        "inventorySha256": manifest["inventorySha256"],
        "scope": "Static byte and complete file/directory inventory verification only",
        "applicationOrBrowserOrProviderExecuted": False,
        "historicalReleaseContractReevaluated": False,
        "authenticityOrReleaseReadinessEstablished": False,
    }


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) > 1:
        print("Usage: python3 checks/check_public_source_v1.py [package-root]", file=sys.stderr)
        return 2
    try:
        result = check(argv[0] if argv else ".")
    except (VerificationError, OSError, ValueError, TypeError, RecursionError) as error:
        print("Current source verification failed: " + str(error), file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
