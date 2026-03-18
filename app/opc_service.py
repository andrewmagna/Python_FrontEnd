from __future__ import annotations

from typing import Optional

from opcua import Client

from app.config_store import load_config

client: Optional[Client] = None
connected = False


def connect():
    global client, connected

    cfg = load_config()

    try:
        client = Client("opc.tcp://192.168.0.149:4850/Magna_IOServer")
        client.set_user("")
        client.set_password("")
        client.connect()

        connected = True
        print("OPC connected")

    except Exception as e:
        client = None
        connected = False
        print("OPC connection failed:", e)


def is_connected() -> bool:
    return connected


def _require_connection():
    if not connected or client is None:
        raise Exception("OPC not connected")


def _get_objects_node():
    _require_connection()
    root = client.get_root_node()
    return root.get_child(["0:Objects"])


def _safe_int(value, default=None):
    try:
        return int(value)
    except Exception:
        return default


def get_table_orientation() -> Optional[int]:
    """
    Returns:
        1 -> 0 degrees
        2 -> 90 degrees
        3 -> 180 degrees
        4 -> 270 degrees

    Returns None if OPC is disconnected or the node cannot be read.
    """
    if not connected or client is None:
        return None

    try:
        objects = _get_objects_node()
        node = objects.get_child(["2:Table_Orientation"])
        value = node.get_value()
        orientation = _safe_int(value, default=None)

        if orientation not in (1, 2, 3, 4):
            return None

        return orientation

    except Exception as e:
        print("Failed reading Table_Orientation:", e)
        return None


def get_table_orientation_degrees() -> Optional[int]:
    orientation = get_table_orientation()

    mapping = {
        1: 0,
        2: 90,
        3: 180,
        4: 270,
    }

    return mapping.get(orientation)


def write_zones(part_id, zones):
    _require_connection()

    objects = _get_objects_node()

    for i in range(1, 41):
        node = objects.get_child([f"2:Zone_{i}_CMD"])
        val = 1 if zones.get(str(i)) or zones.get(i) else 0
        node.set_value(val)

    part_node = objects.get_child(["2:part_name"])
    part_node.set_value(part_id)