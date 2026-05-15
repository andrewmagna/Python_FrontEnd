"""
create_dummy_oee_source_data.py

Purpose:
    Create and populate dummy source tables for testing the OEE dashboard.

Database:
    AutoLaunch_Dummy

Tables created:
    Process_Logger
    Operation_Logger
    Downtime_Logger

This script does NOT create or populate OEE_Logger.
The point is to test the real OEE calculation script against realistic source data.

Generated data:
    - Last 7 days
    - One shift per day
    - 06:00 to 18:00
    - Robot movement operations
    - Sanding operations
    - Media change programs
    - Idle gaps
    - E-stop downtime events
    - Events that cross hour boundaries

Requirements:
    pip install pyodbc
"""

import random
from datetime import datetime, timedelta, time

import pyodbc


# =============================================================================
# DATABASE CONNECTION CONFIG
# =============================================================================

DB_SERVER = "localhost"
DB_NAME = "AutoLaunch_Dummy"
DB_USER = "SA"
DB_PASSWORD = "Admin123"

CONNECTION_STRING = (
    "DRIVER={ODBC Driver 18 for SQL Server};"
    f"SERVER={DB_SERVER};"
    f"DATABASE={DB_NAME};"
    f"UID={DB_USER};"
    f"PWD={DB_PASSWORD};"
    "TrustServerCertificate=yes;"
)


# =============================================================================
# DUMMY DATA SETTINGS
# =============================================================================

DAYS_TO_GENERATE = 7

SHIFT_START = time(6, 0, 0)
SHIFT_END = time(18, 0, 0)

OPERATORS = [
    "Andrew",
    "Operator_A",
    "Operator_B",
    "Operator_C",
]

SANDING_PROGRAMS = [
    "Door_Sanding_Main",
    "Door_Sanding_Edge",
    "Door_Sanding_Corner",
    "Door_Sanding_Final_Pass",
]

NON_SANDING_PROGRAMS = [
    "Home_Position",
    "Part_Load",
    "Part_Unload",
    "Robot_Travel",
    "Tool_Check",
    "Fixture_Clear",
]

MEDIA_PROGRAMS = [
    "Media_Change_Sandpaper",
    "Media_Change_ScotchBrite",
]

PARTS = [
    "Front_Door_LH",
    "Front_Door_RH",
    "Rear_Door_LH",
    "Rear_Door_RH",
]

DOWNTIME_REASONS = [
    "TP E-Stop",
    "CB E-Stop",
    "Light Curtain",
    "Protective Stop",
    "Robot Reset From E-Stop",
]


# =============================================================================
# DB HELPERS
# =============================================================================

def get_connection():
    """Connect to MSSQL."""
    return pyodbc.connect(CONNECTION_STRING)


def create_tables(conn):
    """
    Create the 3 source tables if they do not exist.

    These schemas are intentionally aligned with the earlier OEE script:
        Process_Logger uses Start_Time and Complete_Time.
        Operation_Logger uses Start_Time and Complete_Time.
        Downtime_Logger uses Start_Time and End_Time.
    """

    sql = """
    IF OBJECT_ID('Process_Logger', 'U') IS NULL
    BEGIN
        CREATE TABLE Process_Logger (
            id INT IDENTITY(1,1) PRIMARY KEY,
            Start_Time DATETIME2 NOT NULL,
            Complete_Time DATETIME2 NOT NULL,
            Cycle_Time FLOAT NOT NULL,
            Program_Name NVARCHAR(255) NOT NULL,
            Local_time_Col DATETIME2 NOT NULL,
            User_Col NVARCHAR(255) NOT NULL
        );
    END;

    IF OBJECT_ID('Operation_Logger', 'U') IS NULL
    BEGIN
        CREATE TABLE Operation_Logger (
            id INT IDENTITY(1,1) PRIMARY KEY,
            Local_Time_Col DATETIME2 NOT NULL,
            Start_Time DATETIME2 NOT NULL,
            Complete_Time DATETIME2 NOT NULL,
            Cycle_Time FLOAT NOT NULL,
            User_Col NVARCHAR(255) NOT NULL,
            Cycle_Avg_Force FLOAT NOT NULL,
            Cycle_Avg_Speed FLOAT NOT NULL,
            Sandpaper_Dist_Usage FLOAT NOT NULL,
            Part_Info NVARCHAR(255) NOT NULL,
            Sanding_Operation NVARCHAR(255) NOT NULL,
            Sanding_Zone NVARCHAR(255) NOT NULL,
            Selected_Receipt NVARCHAR(500) NOT NULL
        );
    END;

    IF OBJECT_ID('Downtime_Logger', 'U') IS NULL
    BEGIN
        CREATE TABLE Downtime_Logger (
            id INT IDENTITY(1,1) PRIMARY KEY,
            Start_Time DATETIME2 NOT NULL,
            End_Time DATETIME2 NOT NULL,
            Downtime FLOAT NOT NULL,
            Reason NVARCHAR(255) NOT NULL,
            Local_Time_Col DATETIME2 NOT NULL,
            User_Col NVARCHAR(255) NOT NULL
        );
    END;
    """

    cursor = conn.cursor()
    cursor.execute(sql)
    conn.commit()


def clear_existing_dummy_data(conn):
    """
    Clear old test data.

    This is intentional for a test DB.
    Do not use this script against production unless you enjoy career-limiting events.
    """

    sql = """
    DELETE FROM Downtime_Logger;
    DELETE FROM Operation_Logger;
    DELETE FROM Process_Logger;
    """

    cursor = conn.cursor()
    cursor.execute(sql)
    conn.commit()


# =============================================================================
# INSERT HELPERS
# =============================================================================

def insert_process(conn, start_time, complete_time, program_name, user):
    """Insert one Process_Logger record."""

    cycle_time = (complete_time - start_time).total_seconds()
    local_time = complete_time + timedelta(seconds=random.randint(1, 10))

    sql = """
    INSERT INTO Process_Logger (
        Start_Time,
        Complete_Time,
        Cycle_Time,
        Program_Name,
        Local_time_Col,
        User_Col
    )
    VALUES (?, ?, ?, ?, ?, ?);
    """

    conn.cursor().execute(
        sql,
        start_time,
        complete_time,
        cycle_time,
        program_name,
        local_time,
        user,
    )


def insert_operation(conn, start_time, complete_time, user):
    """
    Insert one Operation_Logger record.

    Operation_Logger represents sanding only.
    Every Operation_Logger record should also have a matching Process_Logger
    record because sanding is also a robot movement operation.
    """

    cycle_time = (complete_time - start_time).total_seconds()

    avg_force = round(random.uniform(18.0, 32.0), 2)
    avg_speed = round(random.uniform(80.0, 145.0), 2)
    distance_usage = round((cycle_time * avg_speed) / 1000.0, 2)

    part = random.choice(PARTS)
    sanding_operation = random.choice(["Sanding", "Scotch-Brite Polishing"])

    zone_choice = random.choice([
        "1",
        "2",
        "3",
        "4",
        "1,2",
        "2,3",
        "1,2,3,4",
        "Full Surface",
    ])

    recipe = (
        f"Passes={random.choice([1, 2, 3])}; "
        f"Grit={random.choice([180, 220, 320, 400])}; "
        f"Force={avg_force}"
    )

    local_time = complete_time + timedelta(seconds=random.randint(1, 10))

    sql = """
    INSERT INTO Operation_Logger (
        Local_Time_Col,
        Start_Time,
        Complete_Time,
        Cycle_Time,
        User_Col,
        Cycle_Avg_Force,
        Cycle_Avg_Speed,
        Sandpaper_Dist_Usage,
        Part_Info,
        Sanding_Operation,
        Sanding_Zone,
        Selected_Receipt
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    """

    conn.cursor().execute(
        sql,
        local_time,
        start_time,
        complete_time,
        cycle_time,
        user,
        avg_force,
        avg_speed,
        distance_usage,
        part,
        sanding_operation,
        zone_choice,
        recipe,
    )


def insert_downtime(conn, start_time, end_time, reason, user):
    """Insert one Downtime_Logger record."""

    downtime_seconds = (end_time - start_time).total_seconds()
    local_time = end_time + timedelta(seconds=random.randint(1, 10))

    sql = """
    INSERT INTO Downtime_Logger (
        Start_Time,
        End_Time,
        Downtime,
        Reason,
        Local_Time_Col,
        User_Col
    )
    VALUES (?, ?, ?, ?, ?, ?);
    """

    conn.cursor().execute(
        sql,
        start_time,
        end_time,
        downtime_seconds,
        reason,
        local_time,
        user,
    )


# =============================================================================
# DATA GENERATION
# =============================================================================

def generate_one_shift(conn, shift_date):
    """
    Generate realistic dummy data for one shift.

    The generated sequence includes:
        - Sanding operations
        - Non-sanding robot movements
        - Media changes
        - Idle gaps
        - Random E-stop downtime events

    Important:
        Downtime is inserted independently.
        The OEE script will subtract E-stop time from available time.
    """

    shift_start_dt = datetime.combine(shift_date, SHIFT_START)
    shift_end_dt = datetime.combine(shift_date, SHIFT_END)

    current_time = shift_start_dt
    user = random.choice(OPERATORS)

    operation_counter = 0

    while current_time < shift_end_dt:
        # Idle gap before next movement operation.
        # This creates realistic idle time because idle is not logged directly.
        idle_gap_minutes = random.randint(2, 12)
        current_time += timedelta(minutes=idle_gap_minutes)

        if current_time >= shift_end_dt:
            break

        operation_counter += 1

        # Decide what kind of robot movement happens next.
        # Most operations are sanding, some are normal movement, some are media changes.
        roll = random.random()

        if roll < 0.65:
            # Sanding operation.
            program_name = random.choice(SANDING_PROGRAMS)
            duration_minutes = random.randint(4, 11)

            start_time = current_time
            complete_time = start_time + timedelta(minutes=duration_minutes)

            if complete_time > shift_end_dt:
                complete_time = shift_end_dt

            insert_process(conn, start_time, complete_time, program_name, user)
            insert_operation(conn, start_time, complete_time, user)

        elif roll < 0.85:
            # Non-sanding robot movement.
            program_name = random.choice(NON_SANDING_PROGRAMS)
            duration_minutes = random.randint(1, 5)

            start_time = current_time
            complete_time = start_time + timedelta(minutes=duration_minutes)

            if complete_time > shift_end_dt:
                complete_time = shift_end_dt

            insert_process(conn, start_time, complete_time, program_name, user)

        else:
            # Media change program.
            # Important for dashboard count testing.
            program_name = random.choice(MEDIA_PROGRAMS)
            duration_minutes = random.randint(3, 8)

            start_time = current_time
            complete_time = start_time + timedelta(minutes=duration_minutes)

            if complete_time > shift_end_dt:
                complete_time = shift_end_dt

            insert_process(conn, start_time, complete_time, program_name, user)

        current_time = complete_time

    # Add a few downtime events per day.
    # Some intentionally cross hour boundaries.
    downtime_event_count = random.randint(2, 5)

    for i in range(downtime_event_count):
        random_hour = random.randint(6, 17)
        random_minute = random.choice([10, 20, 35, 50, 55])

        downtime_start = datetime.combine(
            shift_date,
            time(random_hour, random_minute, 0)
        )

        duration_minutes = random.randint(2, 18)
        downtime_end = downtime_start + timedelta(minutes=duration_minutes)

        if downtime_end > shift_end_dt:
            downtime_end = shift_end_dt

        if downtime_start < shift_end_dt and downtime_end > downtime_start:
            insert_downtime(
                conn,
                downtime_start,
                downtime_end,
                random.choice(DOWNTIME_REASONS),
                user,
            )

    # Add one deliberate edge case on some days:
    # an operation crossing an hour boundary.
    if random.random() < 0.7:
        crossing_start = datetime.combine(shift_date, time(10, 55, 0))
        crossing_end = datetime.combine(shift_date, time(11, 7, 0))

        insert_process(
            conn,
            crossing_start,
            crossing_end,
            "Door_Sanding_Main",
            user,
        )

        insert_operation(
            conn,
            crossing_start,
            crossing_end,
            user,
        )

    # Add one deliberate E-stop crossing an hour boundary on some days.
    if random.random() < 0.7:
        estop_start = datetime.combine(shift_date, time(14, 52, 0))
        estop_end = datetime.combine(shift_date, time(15, 8, 0))

        insert_downtime(
            conn,
            estop_start,
            estop_end,
            "Light Curtain",
            user,
        )


def generate_dummy_data(conn):
    """
    Generate dummy data for the last DAYS_TO_GENERATE days.

    Dates include today and the previous days.
    """

    today = datetime.now().date()

    start_date = today - timedelta(days=DAYS_TO_GENERATE - 1)

    for day_offset in range(DAYS_TO_GENERATE):
        shift_date = start_date + timedelta(days=day_offset)
        print(f"Generating data for {shift_date}")
        generate_one_shift(conn, shift_date)

    conn.commit()


# =============================================================================
# MAIN
# =============================================================================

def main():
    """
    Main execution flow:
        1. Connect to AutoLaunch_Dummy.
        2. Create Process_Logger, Operation_Logger, Downtime_Logger.
        3. Clear existing dummy rows.
        4. Generate 7 days of one-shift dummy data.
    """

    random.seed(42)

    conn = get_connection()

    try:
        create_tables(conn)
        clear_existing_dummy_data(conn)
        generate_dummy_data(conn)

        print("Dummy source data created successfully.")
        print("Tables populated:")
        print("  Process_Logger")
        print("  Operation_Logger")
        print("  Downtime_Logger")

    finally:
        conn.close()


if __name__ == "__main__":
    main()