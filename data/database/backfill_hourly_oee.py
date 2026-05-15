"""
backfill_hourly_oee.py

Purpose:
    Recalculate OEE_Logger rows over a historical time range.

Usage:
    Adjust BACKFILL_START and BACKFILL_END below.

Example:
    BACKFILL_START = datetime(2026, 5, 1, 0, 0, 0)
    BACKFILL_END = datetime(2026, 5, 2, 0, 0, 0)

This calculates:
    2026-05-01 00:00 to 01:00
    2026-05-01 01:00 to 02:00
    ...
    2026-05-01 23:00 to 00:00
"""

from datetime import datetime, timedelta

from calculate_hourly_oee import (
    get_connection,
    ensure_oee_table_exists,
    calculate_hour_metrics,
    upsert_oee_metrics,
)


BACKFILL_START = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=6)
BACKFILL_END   = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)


def main():
    conn = get_connection()

    try:
        ensure_oee_table_exists(conn)

        current_hour_start = BACKFILL_START.replace(minute=0, second=0, microsecond=0)

        while current_hour_start < BACKFILL_END:
            current_hour_end = current_hour_start + timedelta(hours=1)

            metrics = calculate_hour_metrics(
                conn,
                current_hour_start,
                current_hour_end,
            )

            upsert_oee_metrics(conn, metrics)

            print(
                f"Backfilled {current_hour_start} to {current_hour_end}, "
                f"OEE={metrics['oee']:.4f}"
            )

            current_hour_start = current_hour_end

    finally:
        conn.close()


if __name__ == "__main__":
    main()