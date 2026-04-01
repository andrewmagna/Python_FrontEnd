from __future__ import annotations

from typing import Optional
import threading

from opcua import Client, ua

from app.config_store import load_config

client: Optional[Client] = None
connected = False

_objects_node = None
_orientation_node = None
_part_name_node = None
_zone_command_nodes = {}
_logged_missing_nodes = set()

_browse_name_index = {}
_index_built = False
_index_lock = threading.Lock()


def connect():
    global client, connected, _objects_node, _orientation_node, _part_name_node, _zone_command_nodes, _logged_missing_nodes, _browse_name_index, _index_built

    load_config()

    client = None
    connected = False
    _objects_node = None
    _orientation_node = None
    _part_name_node = None
    _zone_command_nodes = {}
    _logged_missing_nodes = set()
    _browse_name_index = {}
    _index_built = False

    try:
        endpoint = "opc.tcp://192.168.0.149:4850/Magna_IOServer"

        client = Client(endpoint)
        client.set_user("")
        client.set_password("")
        client.connect()

        root = client.get_root_node()
        _objects_node = root.get_child(["0:Objects"])

        connected = True
        print("OPC connected")

    except Exception as e:
        client = None
        connected = False
        _objects_node = None
        _orientation_node = None
        _part_name_node = None
        _zone_command_nodes = {}
        _logged_missing_nodes = set()
        _browse_name_index = {}
        _index_built = False
        print("OPC connection failed:", e)


def is_connected() -> bool:
    return connected and client is not None


def _require_connection():
    global connected

    if client is None or not connected:
        raise Exception("OPC not connected")

    if _objects_node is None:
        raise Exception("OPC objects node not available")


def _get_objects_node():
    _require_connection()
    return _objects_node


def _safe_int(value, default=None):
    try:
        return int(value)
    except Exception:
        return default


def _log_missing_node_once(node_name: str):
    if node_name in _logged_missing_nodes:
        return

    _logged_missing_nodes.add(node_name)
    print(f"OPC warning: could not find node {node_name}")


def _set_node_value(node, value, node_name: str):
    try:
        variant_type = node.get_data_type_as_variant_type()
    except Exception:
        variant_type = None

    try:
        if variant_type == ua.VariantType.Boolean:
            node.set_value(ua.DataValue(ua.Variant(bool(value), variant_type)))
            return

        if variant_type in {
            ua.VariantType.SByte,
            ua.VariantType.Byte,
            ua.VariantType.Int16,
            ua.VariantType.UInt16,
            ua.VariantType.Int32,
            ua.VariantType.UInt32,
            ua.VariantType.Int64,
            ua.VariantType.UInt64,
        }:
            node.set_value(ua.DataValue(ua.Variant(int(value), variant_type)))
            return

        if variant_type in {ua.VariantType.Float, ua.VariantType.Double}:
            node.set_value(ua.DataValue(ua.Variant(float(value), variant_type)))
            return

        if variant_type == ua.VariantType.String:
            node.set_value(ua.DataValue(ua.Variant(str(value), variant_type)))
            return

        node.set_value(value)

    except Exception as e:
        print(f"Failed writing {node_name}: {e}")
        raise


def _get_cached_node(cache_name: str, target_name: str):
    global _orientation_node, _part_name_node

    _require_connection()

    if cache_name == "orientation" and _orientation_node is not None:
        return _orientation_node

    if cache_name == "part_name" and _part_name_node is not None:
        return _part_name_node

    node = find_node_by_browse_name(_objects_node, target_name)

    if node is None:
        _log_missing_node_once(target_name)
        return None

    if cache_name == "orientation":
        _orientation_node = node
    elif cache_name == "part_name":
        _part_name_node = node

    return node


def _walk_and_index_nodes(node):
    try:
        children = node.get_children()
    except Exception:
        return

    for child in children:
        try:
            browse_name = child.get_browse_name().Name
        except Exception:
            browse_name = None

        if browse_name and browse_name not in _browse_name_index:
            _browse_name_index[browse_name] = child

        _walk_and_index_nodes(child)


def _ensure_browse_name_index():
    global _index_built

    _require_connection()

    if _index_built:
        return

    with _index_lock:
        if _index_built:
            return

        _browse_name_index.clear()
        _walk_and_index_nodes(_objects_node)
        _index_built = True


def find_node_by_browse_name(node, target_name):
    _ensure_browse_name_index()
    return _browse_name_index.get(target_name)


def get_table_orientation() -> Optional[int]:
    if not is_connected():
        return None

    try:
        node = _get_cached_node("orientation", "Table_Orientation")
        if node is None:
            print("Failed reading Table_Orientation: node not found")
            return None

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
    _ensure_browse_name_index()

    nodes_to_write = []
    values_to_write = []

    for i in range(1, 41):
        node = _zone_command_nodes.get(i)
        node_name = f"Zone_{i}_CMD"

        if node is None:
            node = find_node_by_browse_name(_objects_node, node_name)
            if node is None:
                _log_missing_node_once(node_name)
                print(f"Skipping missing OPC node: {node_name}")
                continue
            _zone_command_nodes[i] = node

        raw_val = 1 if zones.get(str(i)) or zones.get(i) else 0

        try:
            variant_type = node.get_data_type_as_variant_type()
        except Exception:
            variant_type = None

        if variant_type == ua.VariantType.Boolean:
            write_val = ua.DataValue(ua.Variant(bool(raw_val), variant_type))
        elif variant_type in {
            ua.VariantType.SByte,
            ua.VariantType.Byte,
            ua.VariantType.Int16,
            ua.VariantType.UInt16,
            ua.VariantType.Int32,
            ua.VariantType.UInt32,
            ua.VariantType.Int64,
            ua.VariantType.UInt64,
        }:
            write_val = ua.DataValue(ua.Variant(int(raw_val), variant_type))
        elif variant_type in {ua.VariantType.Float, ua.VariantType.Double}:
            write_val = ua.DataValue(ua.Variant(float(raw_val), variant_type))
        else:
            write_val = raw_val

        nodes_to_write.append(node)
        values_to_write.append(write_val)

    if nodes_to_write:
        client.set_values(nodes_to_write, values_to_write)

    part_node = _get_cached_node("part_name", "part_name")
    if part_node is None:
        print("Skipping missing OPC node: part_name")
        return

    _set_node_value(part_node, part_id, "part_name")