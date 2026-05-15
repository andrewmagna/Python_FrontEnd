"""
calculate_hourly_oee.py

Purpose:
    Calculate hourly OEE for a robot sanding cell using three existing MSSQL tables:

        1. Process_Logger
           Records every robot movement operation, including sanding, media changes,
           home moves, setup moves, program transitions, etc.

        2. Operation_Logger
           Records sanding operations only, with additional sanding details.

        3. Downtime_Logger
           Records E-stop downtime only. It does not record general idle time.

    The script writes one row per completed clock hour into:

        OEE_Logger

    This table can then be used by Grafana for hourly and daily OEE dashboards.

Important Assumptions:
    - MSSQL database.
    - Time columns are Start_Time and Complete_Time for Process_Logger and Operation_Logger.
    - Downtime_Logger uses Start_Time and End_Time.
    - Cycle_Time is stored in seconds, but duration is calculated from actual timestamps
      so events crossing hour boundaries can be split correctly.
    - Quality is fixed at 1.0 for now.
    - Media change programs are detected by Program_Name containing "media", case-insensitive.
    - One OEE_Logger row exists per hour_start.
    - The script calculates only completed fixed clock hours.

Recommended Scheduling:
    Run this script every hour, shortly after the hour completes.
    Example:
        9:05 AM calculates 8:00 AM to 9:00 AM

Author:
    Internal automation script for hourly OEE logging.
"""

import pyodbc
from datetime import datetime, timedelta


# =============================================================================
# DATABASE CONFIGURATION
# =============================================================================

# Update these values for your environment.
# Because apparently computers still require passwords and don't just sense intent.
DB_SERVER = "localhost"
DB_NAME = "AutoLaunch_Dummy"
DB_USER = "SA"
DB_PASSWORD = "Admin123"

# If you use Windows Authentication instead, replace the connection string
# in get_connection() with the trusted connection version shown there.


# =============================================================================
# TABLE NAMES
# =============================================================================

PROCESS_TABLE = "Process_Logger"
OPERATION_TABLE = "Operation_Logger"
DOWNTIME_TABLE = "Downtime_Logger"
OEE_TABLE = "OEE_Logger"


# =============================================================================
# CONNECTION
# =============================================================================

def get_connection():
    """
    Create and return a connection to MSSQL using pyodbc.

    Option 1:
        SQL username/password authentication.

    Option 2:
        Windows authentication, commented below.

    Returns:
        pyodbc.Connection
    """

    connection_string = (
        "DRIVER={ODBC Driver 18 for SQL Server};"
        f"SERVER={DB_SERVER};"
        f"DATABASE={DB_NAME};"
        f"UID={DB_USER};"
        f"PWD={DB_PASSWORD};"
        "TrustServerCertificate=yes;"
    )

    # Windows Authentication version:
    # connection_string = (
    #     "DRIVER={ODBC Driver 17 for SQL Server};"
    #     f"SERVER={DB_SERVER};"
    #     f"DATABASE={DB_NAME};"
    #     "Trusted_Connection=yes;"
    #     "TrustServerCertificate=yes;"
    # )

    return pyodbc.connect(connection_string)


# =============================================================================
# TABLE CREATION
# =============================================================================

def ensure_oee_table_exists(conn):
    """
    Creates the OEE_Logger table if it does not already exist.

    The key design choice is that hour_start is unique.
    This allows the script to safely rerun and update the same hour without
    creating duplicate records.

    OEE_Logger is designed for Grafana:
        - Fixed hourly records
        - Time-based filtering
        - Daily grouping
        - Hourly trend charts
        - KPI cards
    """

    create_sql = f"""
    IF OBJECT_ID('{OEE_TABLE}', 'U') IS NULL
    BEGIN
        CREATE TABLE {OEE_TABLE} (
            id INT IDENTITY(1,1) PRIMARY KEY,

            hour_start DATETIME2 NOT NULL,
            hour_end DATETIME2 NOT NULL,

            shift_length_seconds FLOAT NOT NULL,
            estop_time_seconds FLOAT NOT NULL,
            available_time_seconds FLOAT NOT NULL,
            operating_time_seconds FLOAT NOT NULL,
            idle_time_seconds FLOAT NOT NULL,
            sanding_time_seconds FLOAT NOT NULL,

            availability FLOAT NOT NULL,
            performance FLOAT NOT NULL,
            quality FLOAT NOT NULL,
            oee FLOAT NOT NULL,

            media_change_count INT NOT NULL,
            sanding_operation_count INT NOT NULL,

            created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
            updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),

            CONSTRAINT UQ_{OEE_TABLE}_hour_start UNIQUE (hour_start)
        );
    END
    """

    cursor = conn.cursor()
    cursor.execute(create_sql)
    conn.commit()


# =============================================================================
# TIME HELPERS
# =============================================================================

def get_previous_completed_hour(now=None):
    """
    Determine the most recent completed fixed clock hour.

    Example:
        If current time is 9:05,
        the completed hour is 8:00 to 9:00.

    Args:
        now: Optional datetime for testing.

    Returns:
        tuple(datetime, datetime): hour_start, hour_end
    """

    if now is None:
        now = datetime.now()

    current_hour_start = now.replace(minute=0, second=0, microsecond=0)
    hour_end = current_hour_start
    hour_start = hour_end - timedelta(hours=1)

    return hour_start, hour_end


# =============================================================================
# CALCULATION QUERY
# =============================================================================

def calculate_hour_metrics(conn, hour_start, hour_end):
    """
    Calculate all OEE metrics for a single fixed clock hour.

    The main technical challenge:
        Events may cross hour boundaries.

    Example:
        A process starts at 8:55 and ends at 9:05.
        For the 8:00 to 9:00 row, only 5 minutes count.
        For the 9:00 to 10:00 row, only 5 minutes count.

    This script calculates overlap duration using:
        MAX(event_start, hour_start)
        MIN(event_end, hour_end)

    MSSQL does not have simple GREATEST / LEAST in older versions,
    so CASE statements are used. A beautiful little monument to inconvenience.

    Args:
        conn: pyodbc connection
        hour_start: datetime
        hour_end: datetime

    Returns:
        dict containing all hourly OEE metrics
    """

    sql = f"""
    DECLARE @HourStart DATETIME2 = ?;
    DECLARE @HourEnd DATETIME2 = ?;
    DECLARE @ShiftLengthSeconds FLOAT = DATEDIFF(SECOND, @HourStart, @HourEnd);

    ;WITH

    ProcessOverlaps AS (
        SELECT
            Start_Time,
            Complete_Time,
            Program_Name,

            DATEDIFF(
                SECOND,
                CASE
                    WHEN Start_Time < @HourStart THEN @HourStart
                    ELSE Start_Time
                END,
                CASE
                    WHEN Complete_Time > @HourEnd THEN @HourEnd
                    ELSE Complete_Time
                END
            ) AS overlap_seconds
        FROM {PROCESS_TABLE}
        WHERE
            Start_Time IS NOT NULL
            AND Complete_Time IS NOT NULL
            AND Complete_Time > Start_Time
            AND Start_Time < @HourEnd
            AND Complete_Time > @HourStart
    ),

    OperationOverlaps AS (
        SELECT
            Start_Time,
            Complete_Time,

            DATEDIFF(
                SECOND,
                CASE
                    WHEN Start_Time < @HourStart THEN @HourStart
                    ELSE Start_Time
                END,
                CASE
                    WHEN Complete_Time > @HourEnd THEN @HourEnd
                    ELSE Complete_Time
                END
            ) AS overlap_seconds
        FROM {OPERATION_TABLE}
        WHERE
            Start_Time IS NOT NULL
            AND Complete_Time IS NOT NULL
            AND Complete_Time > Start_Time
            AND Start_Time < @HourEnd
            AND Complete_Time > @HourStart
    ),

    DowntimeOverlaps AS (
        SELECT
            Start_Time,
            End_Time,

            DATEDIFF(
                SECOND,
                CASE
                    WHEN Start_Time < @HourStart THEN @HourStart
                    ELSE Start_Time
                END,
                CASE
                    WHEN End_Time > @HourEnd THEN @HourEnd
                    ELSE End_Time
                END
            ) AS overlap_seconds
        FROM {DOWNTIME_TABLE}
        WHERE
            Start_Time IS NOT NULL
            AND End_Time IS NOT NULL
            AND End_Time > Start_Time
            AND Start_Time < @HourEnd
            AND End_Time > @HourStart
    ),

    ProcessAgg AS (
        SELECT
            COALESCE(SUM(overlap_seconds), 0) AS operating_time_seconds,

            COALESCE(SUM(
                CASE
                    WHEN LOWER(LTRIM(RTRIM(COALESCE(Program_Name, '')))) LIKE '%media%'
                    THEN 1
                    ELSE 0
                END
            ), 0) AS media_change_count
        FROM ProcessOverlaps
    ),

    OperationAgg AS (
        SELECT
            COALESCE(SUM(overlap_seconds), 0) AS sanding_time_seconds,
            COUNT(*) AS sanding_operation_count
        FROM OperationOverlaps
    ),

    DowntimeAgg AS (
        SELECT
            COALESCE(SUM(overlap_seconds), 0) AS estop_time_seconds
        FROM DowntimeOverlaps
    )

    SELECT
        @HourStart AS hour_start,
        @HourEnd AS hour_end,
        @ShiftLengthSeconds AS shift_length_seconds,

        CAST(d.estop_time_seconds AS FLOAT) AS estop_time_seconds,

        CAST(
            CASE
                WHEN @ShiftLengthSeconds - d.estop_time_seconds < 0 THEN 0
                ELSE @ShiftLengthSeconds - d.estop_time_seconds
            END
        AS FLOAT) AS available_time_seconds,

        CAST(p.operating_time_seconds AS FLOAT) AS operating_time_seconds,

        CAST(
            CASE
                WHEN (@ShiftLengthSeconds - d.estop_time_seconds) - p.operating_time_seconds < 0 THEN 0
                ELSE (@ShiftLengthSeconds - d.estop_time_seconds) - p.operating_time_seconds
            END
        AS FLOAT) AS idle_time_seconds,

        CAST(o.sanding_time_seconds AS FLOAT) AS sanding_time_seconds,

        CAST(
            CASE
                WHEN @ShiftLengthSeconds <= 0 THEN 0
                ELSE
                    CASE
                        WHEN (@ShiftLengthSeconds - d.estop_time_seconds) < 0 THEN 0
                        ELSE (@ShiftLengthSeconds - d.estop_time_seconds) / @ShiftLengthSeconds
                    END
            END
        AS FLOAT) AS availability,

        CAST(
            CASE
                WHEN p.operating_time_seconds <= 0 THEN 0
                ELSE o.sanding_time_seconds / p.operating_time_seconds
            END
        AS FLOAT) AS performance,

        CAST(1.0 AS FLOAT) AS quality,

        CAST(
            (
                CASE
                    WHEN @ShiftLengthSeconds <= 0 THEN 0
                    ELSE
                        CASE
                            WHEN (@ShiftLengthSeconds - d.estop_time_seconds) < 0 THEN 0
                            ELSE (@ShiftLengthSeconds - d.estop_time_seconds) / @ShiftLengthSeconds
                        END
                END
            )
            *
            (
                CASE
                    WHEN p.operating_time_seconds <= 0 THEN 0
                    ELSE o.sanding_time_seconds / p.operating_time_seconds
                END
            )
            *
            1.0
        AS FLOAT) AS oee,

        CAST(p.media_change_count AS INT) AS media_change_count,
        CAST(o.sanding_operation_count AS INT) AS sanding_operation_count

    FROM ProcessAgg p
    CROSS JOIN OperationAgg o
    CROSS JOIN DowntimeAgg d;
    """

    cursor = conn.cursor()
    cursor.execute(sql, hour_start, hour_end)
    row = cursor.fetchone()

    if row is None:
        raise RuntimeError("No metrics returned from OEE calculation query.")

    return {
        "hour_start": row.hour_start,
        "hour_end": row.hour_end,
        "shift_length_seconds": row.shift_length_seconds,
        "estop_time_seconds": row.estop_time_seconds,
        "available_time_seconds": row.available_time_seconds,
        "operating_time_seconds": row.operating_time_seconds,
        "idle_time_seconds": row.idle_time_seconds,
        "sanding_time_seconds": row.sanding_time_seconds,
        "availability": row.availability,
        "performance": row.performance,
        "quality": row.quality,
        "oee": row.oee,
        "media_change_count": row.media_change_count,
        "sanding_operation_count": row.sanding_operation_count,
    }


# =============================================================================
# UPSERT INTO OEE_LOGGER
# =============================================================================

def upsert_oee_metrics(conn, metrics):
    """
    Insert or update one hourly OEE record.

    Why MERGE?
        Because the script may rerun for the same completed hour.
        A unique row per hour_start prevents duplicate records.

    If the row exists:
        Update the calculated metrics and updated_at timestamp.

    If the row does not exist:
        Insert a new row.

    Args:
        conn: pyodbc connection
        metrics: dict returned by calculate_hour_metrics()
    """

    sql = f"""
    MERGE {OEE_TABLE} AS target
    USING (
        SELECT
            ? AS hour_start,
            ? AS hour_end,
            ? AS shift_length_seconds,
            ? AS estop_time_seconds,
            ? AS available_time_seconds,
            ? AS operating_time_seconds,
            ? AS idle_time_seconds,
            ? AS sanding_time_seconds,
            ? AS availability,
            ? AS performance,
            ? AS quality,
            ? AS oee,
            ? AS media_change_count,
            ? AS sanding_operation_count
    ) AS source
    ON target.hour_start = source.hour_start

    WHEN MATCHED THEN
        UPDATE SET
            hour_end = source.hour_end,
            shift_length_seconds = source.shift_length_seconds,
            estop_time_seconds = source.estop_time_seconds,
            available_time_seconds = source.available_time_seconds,
            operating_time_seconds = source.operating_time_seconds,
            idle_time_seconds = source.idle_time_seconds,
            sanding_time_seconds = source.sanding_time_seconds,
            availability = source.availability,
            performance = source.performance,
            quality = source.quality,
            oee = source.oee,
            media_change_count = source.media_change_count,
            sanding_operation_count = source.sanding_operation_count,
            updated_at = SYSUTCDATETIME()

    WHEN NOT MATCHED THEN
        INSERT (
            hour_start,
            hour_end,
            shift_length_seconds,
            estop_time_seconds,
            available_time_seconds,
            operating_time_seconds,
            idle_time_seconds,
            sanding_time_seconds,
            availability,
            performance,
            quality,
            oee,
            media_change_count,
            sanding_operation_count,
            created_at,
            updated_at
        )
        VALUES (
            source.hour_start,
            source.hour_end,
            source.shift_length_seconds,
            source.estop_time_seconds,
            source.available_time_seconds,
            source.operating_time_seconds,
            source.idle_time_seconds,
            source.sanding_time_seconds,
            source.availability,
            source.performance,
            source.quality,
            source.oee,
            source.media_change_count,
            source.sanding_operation_count,
            SYSUTCDATETIME(),
            SYSUTCDATETIME()
        );
    """

    cursor = conn.cursor()
    cursor.execute(
        sql,
        metrics["hour_start"],
        metrics["hour_end"],
        metrics["shift_length_seconds"],
        metrics["estop_time_seconds"],
        metrics["available_time_seconds"],
        metrics["operating_time_seconds"],
        metrics["idle_time_seconds"],
        metrics["sanding_time_seconds"],
        metrics["availability"],
        metrics["performance"],
        metrics["quality"],
        metrics["oee"],
        metrics["media_change_count"],
        metrics["sanding_operation_count"],
    )
    conn.commit()


# =============================================================================
# MAIN EXECUTION
# =============================================================================

def main():
    """
    Main script execution.

    Steps:
        1. Connect to MSSQL.
        2. Create OEE_Logger if it does not exist.
        3. Determine the previous completed clock hour.
        4. Calculate all metrics for that hour.
        5. Insert or update OEE_Logger.
        6. Print a concise summary for logs.
    """

    hour_start, hour_end = get_previous_completed_hour()

    conn = get_connection()

    try:
        ensure_oee_table_exists(conn)

        metrics = calculate_hour_metrics(conn, hour_start, hour_end)

        upsert_oee_metrics(conn, metrics)

        print("Hourly OEE calculation completed successfully.")
        print(f"Hour: {metrics['hour_start']} to {metrics['hour_end']}")
        print(f"Availability: {metrics['availability']:.4f}")
        print(f"Performance: {metrics['performance']:.4f}")
        print(f"Quality: {metrics['quality']:.4f}")
        print(f"OEE: {metrics['oee']:.4f}")
        print(f"Media Changes: {metrics['media_change_count']}")
        print(f"Sanding Operations: {metrics['sanding_operation_count']}")

    finally:
        conn.close()


if __name__ == "__main__":
    main()