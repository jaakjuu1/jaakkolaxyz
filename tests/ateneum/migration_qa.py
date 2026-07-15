#!/usr/bin/env python3
"""Exercise a release and its rollback bundle against a copied Ateneum DB."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import socket
import sqlite3
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def wait_http(url: str, process: subprocess.Popen[Any], timeout: float = 25.0) -> None:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"bundle exited before readiness with code {process.returncode}")
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status == 200:
                    return
        except Exception as error:
            last_error = error
        time.sleep(0.15)
    raise RuntimeError(f"bundle did not become ready at {url}: {last_error}")


def start_and_stop(bundle: Path, database: Path, label: str, log_dir: Path) -> None:
    port = free_port()
    env = os.environ.copy()
    env.update(
        {
            "NODE_ENV": "production",
            "NODE_PATH": str(ROOT / "node_modules"),
            "PORT": str(port),
            "ATENEUM_DB_PATH": str(database),
        }
    )
    log_path = log_dir / f"{label}.log"
    with log_path.open("wb") as log:
        process = subprocess.Popen(
            ["node", str(bundle)],
            cwd=ROOT,
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
        )
        try:
            wait_http(f"http://127.0.0.1:{port}/ateneum/", process)
        except Exception:
            log.flush()
            lines = log_path.read_text(errors="replace").splitlines()[-50:]
            if lines:
                print(f"--- {label} log tail ---")
                print("\n".join(lines))
            raise
        finally:
            process.terminate()
            try:
                process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=3)


def table_exists(db: sqlite3.Connection, name: str) -> bool:
    return bool(
        db.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
        ).fetchone()
    )


def inspect_before(database: Path) -> dict[str, Any]:
    with sqlite3.connect(f"file:{database}?mode=ro", uri=True) as db:
        quick = db.execute("PRAGMA quick_check").fetchone()[0]
        foreign_keys = len(db.execute("PRAGMA foreign_key_check").fetchall())
        activity_columns = {
            str(row[1]) for row in db.execute("PRAGMA table_info(ateneum_activities)").fetchall()
        }
        has_planning = "planning_mode" in activity_columns
        has_acceptances = table_exists(db, "ateneum_activity_acceptances")
        has_requests = table_exists(db, "ateneum_plan_requests")
        request_columns = (
            {
                str(row[1])
                for row in db.execute("PRAGMA table_info(ateneum_plan_requests)").fetchall()
            }
            if has_requests else set()
        )
        if has_requests and "source_type" in request_columns:
            source_counts = {
                str(source): int(count)
                for source, count in db.execute(
                    "SELECT source_type, count(*) FROM ateneum_plan_requests GROUP BY source_type"
                ).fetchall()
            }
        elif has_requests:
            source_counts = {"idea": int(db.execute(
                "SELECT count(*) FROM ateneum_plan_requests"
            ).fetchone()[0])}
        else:
            source_counts = {}
        state = {
            "quick": str(quick),
            "foreignKeys": foreign_keys,
            "activities": int(db.execute("SELECT count(*) FROM ateneum_activities").fetchone()[0]),
            "users": int(db.execute("SELECT count(*) FROM ateneum_users").fetchone()[0]),
            "hadPlanningColumns": has_planning,
            "nonLegacyActivities": int(db.execute(
                "SELECT count(*) FROM ateneum_activities WHERE planning_mode <> 'legacy' OR version < 1"
            ).fetchone()[0]) if has_planning else 0,
            "acceptanceRows": int(db.execute(
                "SELECT count(*) FROM ateneum_activity_acceptances"
            ).fetchone()[0]) if has_acceptances else 0,
            "planRequestRows": int(db.execute(
                "SELECT count(*) FROM ateneum_plan_requests"
            ).fetchone()[0]) if has_requests else 0,
            "planRequestSourceCounts": source_counts,
        }
    if quick != "ok" or foreign_keys:
        raise AssertionError(f"source DB is unhealthy: quick={quick}, foreignKeys={foreign_keys}")
    return state


def inspect_after(database: Path, expected: dict[str, Any]) -> dict[str, Any]:
    with sqlite3.connect(f"file:{database}?mode=ro", uri=True) as db:
        quick = db.execute("PRAGMA quick_check").fetchone()[0]
        foreign_keys = len(db.execute("PRAGMA foreign_key_check").fetchall())
        activity_columns = {
            str(row[1]) for row in db.execute("PRAGMA table_info(ateneum_activities)").fetchall()
        }
        required_activity_columns = {
            "planning_mode", "version", "proposed_by", "updated_by", "updated_at",
        }
        missing_activity = sorted(required_activity_columns - activity_columns)
        request_columns = {
            str(row[1]) for row in db.execute("PRAGMA table_info(ateneum_plan_requests)").fetchall()
        }
        required_request_columns = {"source_type", "idea_id", "activity_id", "plan_id", "base_version"}
        missing_request = sorted(required_request_columns - request_columns)
        request_sql_row = db.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='ateneum_plan_requests'"
        ).fetchone()
        request_sql = str(request_sql_row[0]) if request_sql_row else ""
        indexes = {
            str(row[1]) for row in db.execute("PRAGMA index_list(ateneum_plan_requests)").fetchall()
        }
        required_indexes = {
            "idx_ateneum_plan_requests_status_created",
            "idx_ateneum_plan_requests_claim_key",
            "idx_ateneum_plan_requests_requester_idea",
            "idx_ateneum_plan_requests_requester_activity",
            "idx_ateneum_plan_requests_requester_plan_version",
        }
        source_counts = {
            str(source): int(count)
            for source, count in db.execute(
                "SELECT source_type, count(*) FROM ateneum_plan_requests GROUP BY source_type"
            ).fetchall()
        }
        actual = {
            "activities": int(db.execute("SELECT count(*) FROM ateneum_activities").fetchone()[0]),
            "users": int(db.execute("SELECT count(*) FROM ateneum_users").fetchone()[0]),
            "nonLegacyActivities": int(db.execute(
                "SELECT count(*) FROM ateneum_activities WHERE planning_mode <> 'legacy' OR version < 1"
            ).fetchone()[0]),
            "acceptanceRows": int(db.execute(
                "SELECT count(*) FROM ateneum_activity_acceptances"
            ).fetchone()[0]),
            "planRequestRows": int(db.execute(
                "SELECT count(*) FROM ateneum_plan_requests"
            ).fetchone()[0]),
            "planRequestSourceCounts": source_counts,
        }
    expected_non_legacy = expected["nonLegacyActivities"] if expected["hadPlanningColumns"] else 0
    failures = {
        "quick": quick != "ok",
        "foreignKeys": foreign_keys != 0,
        "missingActivityColumns": bool(missing_activity),
        "missingRequestColumns": bool(missing_request),
        "missingRequestIndexes": not required_indexes.issubset(indexes),
        "planSourceConstraint": "'plan'" not in request_sql,
        "activityCount": actual["activities"] != expected["activities"],
        "userCount": actual["users"] != expected["users"],
        "nonLegacyPreservation": actual["nonLegacyActivities"] != expected_non_legacy,
        "acceptancePreservation": actual["acceptanceRows"] != expected["acceptanceRows"],
        "requestCount": actual["planRequestRows"] != expected["planRequestRows"],
        "requestSourceCounts": actual["planRequestSourceCounts"] != expected["planRequestSourceCounts"],
    }
    if any(failures.values()):
        raise AssertionError(json.dumps({
            "failures": failures,
            "missingActivityColumns": missing_activity,
            "missingRequestColumns": missing_request,
            "missingRequestIndexes": sorted(required_indexes - indexes),
            "quick": quick,
            "foreignKeys": foreign_keys,
            "actual": actual,
        }, sort_keys=True))
    return {
        "quick": quick,
        "foreignKeys": foreign_keys,
        **actual,
        "requiredActivityColumns": sorted(required_activity_columns),
        "requiredRequestColumns": sorted(required_request_columns),
        "requiredRequestIndexes": sorted(required_indexes),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("database_copy", type=Path)
    parser.add_argument("rollback_bundle", type=Path)
    parser.add_argument("--release-bundle", type=Path, default=ROOT / "dist" / "index.cjs")
    args = parser.parse_args()

    for path, label in (
        (args.database_copy, "database copy"),
        (args.rollback_bundle, "rollback bundle"),
        (args.release_bundle, "release bundle"),
    ):
        if not path.is_file():
            raise SystemExit(f"missing {label}: {path}")

    before = inspect_before(args.database_copy)
    with tempfile.TemporaryDirectory(prefix="ateneum-migration-qa-") as temp:
        temp_path = Path(temp)
        database = temp_path / "ateneum.db"
        shutil.copy2(args.database_copy, database)
        start_and_stop(args.release_bundle.resolve(), database, "release", temp_path)
        migrated = inspect_after(database, before)
        rollback_dist = temp_path / "rollback-dist"
        rollback_dist.mkdir()
        rollback_bundle = rollback_dist / "index.cjs"
        shutil.copy2(args.rollback_bundle, rollback_bundle)
        shutil.copytree(ROOT / "dist" / "public", rollback_dist / "public")
        start_and_stop(rollback_bundle, database, "rollback", temp_path)
        after_rollback = inspect_after(database, before)

    print("ATENEUM_MIGRATION_QA=PASS")
    print(
        json.dumps(
            {
                "source": before,
                "afterRelease": migrated,
                "afterRollbackStart": after_rollback,
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
