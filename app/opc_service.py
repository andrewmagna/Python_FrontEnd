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
_user_name_node = None
_recipe_name_node = None
_zone_list_node = None
_shift_start_time_node = None
_shift_end_time_node = None
_shift_completed_node = None
_shift_started_node = None
_force_reading_node = None
_program_started_node = None
_cycle_started_node = None
_cycle_completed_node = None
_opc_status_node = None
_path_pass_nodes = {}
_path_grit_nodes = {}
_path_force_nodes = {}
_zone_command_nodes = {}
_logged_missing_nodes = set()
_logged_unrecognized_bool = set()

_browse_name_index = {}
_index_built = False
_index_lock = threading.Lock()


def _write_opc_status(value: bool) -> None:
    if _opc_status_node is not None and client is not None:
        try:
            _set_node_value(_opc_status_node, value, "OPC_Status")
        except Exception:
            pass


def _post_connect_setup() -> None:
    _ensure_browse_name_index()
    if not is_connected():
        return
    try:
        node = _get_cached_node("opc_status", "OPC_Status")
        if node is None:
            return
        _set_node_value(node, True, "OPC_Status")
    except Exception as e:
        print(f"Failed writing OPC_Status=true: {e}")


def connect():
    global client, connected, _objects_node, _orientation_node, _part_name_node, _user_name_node, _recipe_name_node, _zone_list_node, _shift_start_time_node, _shift_end_time_node, _shift_completed_node, _shift_started_node, _force_reading_node, _program_started_node, _cycle_started_node, _cycle_completed_node, _opc_status_node, _path_pass_nodes, _path_grit_nodes, _path_force_nodes, _zone_command_nodes, _logged_missing_nodes, _browse_name_index, _index_built

    load_config()

    # Write OPC_Status=false before dropping existing connection (only fires once per disconnect)
    if connected and client is not None:
        _write_opc_status(False)

    if client is not None:
        try:
            client.disconnect()
        except Exception:
            pass

    client = None
    connected = False
    _objects_node = None
    _orientation_node = None
    _part_name_node = None
    _user_name_node = None
    _recipe_name_node = None
    _zone_list_node = None
    _shift_start_time_node = None
    _shift_end_time_node = None
    _shift_completed_node = None
    _shift_started_node = None
    _force_reading_node = None
    _program_started_node = None
    _cycle_started_node = None
    _cycle_completed_node = None
    _opc_status_node = None
    _path_pass_nodes = {}
    _path_grit_nodes = {}
    _path_force_nodes = {}
    _zone_command_nodes = {}
    _logged_missing_nodes = set()
    _logged_unrecognized_bool = set()
    _browse_name_index = {}
    _index_built = False

    try:
        endpoint = "opc.tcp://127.0.0.1:4850/Magna_IOServer"

        client = Client(endpoint)
        client.set_user("")
        client.set_password("")
        client.connect()

        root = client.get_root_node()
        _objects_node = root.get_child(["0:Objects"])

        connected = True
        print("OPC connected")

        threading.Thread(target=_post_connect_setup, daemon=True).start()

    except Exception as e:
        client = None
        connected = False
        _objects_node = None
        _orientation_node = None
        _part_name_node = None
        _user_name_node = None
        _recipe_name_node = None
        _zone_list_node = None
        _shift_start_time_node = None
        _shift_end_time_node = None
        _shift_completed_node = None
        _shift_started_node = None
        _force_reading_node = None
        _opc_status_node = None
        _path_pass_nodes = {}
        _path_grit_nodes = {}
        _path_force_nodes = {}
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


def _safe_float(value, default=None):
    try:
        return float(value)
    except Exception:
        return default


def _coerce_bool(value, tag_name: str = "") -> bool:
    """Coerce an OPC value of unknown type to a real boolean.
    Strings like '0', 'false', 'off', '' must NOT read as True."""
    if value is None:
        return False
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        s = value.strip().lower()
        if s in ("", "0", "false", "off", "no", "none", "null"):
            return False
        if s in ("1", "true", "on", "yes"):
            return True
        try:
            return float(s) != 0
        except ValueError:
            if tag_name and tag_name not in _logged_unrecognized_bool:
                _logged_unrecognized_bool.add(tag_name)
                print(f"OPC warning: unrecognized boolean string for {tag_name!r}: {value!r}, treating as False")
            return False
    return bool(value)


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



def _default_paths():
    return [
        {"passes": 0, "grit": 80, "force": 10},
        {"passes": 0, "grit": 120, "force": 10},
        {"passes": 0, "grit": 180, "force": 10},
        {"passes": 0, "force": 10},
    ]


def _get_cached_node(cache_name: str, target_name: str):
    global _orientation_node, _part_name_node, _user_name_node, _recipe_name_node, _zone_list_node, _shift_start_time_node, _shift_end_time_node, _shift_completed_node, _shift_started_node, _force_reading_node, _program_started_node, _cycle_started_node, _cycle_completed_node, _opc_status_node

    _require_connection()

    if cache_name == "orientation" and _orientation_node is not None:
        return _orientation_node

    if cache_name == "part_name" and _part_name_node is not None:
        return _part_name_node

    if cache_name == "user_name" and _user_name_node is not None:
        return _user_name_node

    if cache_name == "recipe_name" and _recipe_name_node is not None:
        return _recipe_name_node
    
    if cache_name == "zone_list" and _zone_list_node is not None:
        return _zone_list_node

    if cache_name == "shift_start_time" and _shift_start_time_node is not None:
        return _shift_start_time_node

    if cache_name == "shift_end_time" and _shift_end_time_node is not None:
        return _shift_end_time_node

    if cache_name == "shift_completed" and _shift_completed_node is not None:
        return _shift_completed_node

    if cache_name == "shift_started" and _shift_started_node is not None:
        return _shift_started_node

    if cache_name == "force_reading" and _force_reading_node is not None:
        return _force_reading_node

    if cache_name == "program_started" and _program_started_node is not None:
        return _program_started_node

    if cache_name == "cycle_started" and _cycle_started_node is not None:
        return _cycle_started_node

    if cache_name == "cycle_completed" and _cycle_completed_node is not None:
        return _cycle_completed_node

    if cache_name == "opc_status" and _opc_status_node is not None:
        return _opc_status_node

    node = find_node_by_browse_name(_objects_node, target_name)

    if node is None:
        _log_missing_node_once(target_name)
        return None

    if cache_name == "orientation":
        _orientation_node = node
    elif cache_name == "part_name":
        _part_name_node = node
    elif cache_name == "user_name":
        _user_name_node = node
    elif cache_name == "recipe_name":
        _recipe_name_node = node
    elif cache_name == "zone_list":
        _zone_list_node = node
    elif cache_name == "shift_start_time":
        _shift_start_time_node = node
    elif cache_name == "shift_end_time":
        _shift_end_time_node = node
    elif cache_name == "shift_completed":
        _shift_completed_node = node
    elif cache_name == "shift_started":
        _shift_started_node = node
    elif cache_name == "force_reading":
        _force_reading_node = node
    elif cache_name == "program_started":
        _program_started_node = node
    elif cache_name == "cycle_started":
        _cycle_started_node = node
    elif cache_name == "cycle_completed":
        _cycle_completed_node = node
    elif cache_name == "opc_status":
        _opc_status_node = node

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


def get_force_reading() -> Optional[float]:
    if not is_connected():
        return None

    try:
        node = _get_cached_node("force_reading", "ATC_Force_Reading")
        if node is None:
            print("Failed reading ATC_Force_Reading: node not found")
            return None

        value = node.get_value()
        reading = _safe_float(value, default=None)

        if reading is None:
            return None

        return round(reading, 2)

    except Exception as e:
        print("Failed reading ATC_Force_Reading:", e)
        return None


def get_program_tags() -> dict:
    _default = {"program_started": False, "cycle_started": False, "cycle_completed": False}

    if not is_connected():
        return _default

    try:
        ps_node = _get_cached_node("program_started", "Program_Started")
        cs_node = _get_cached_node("cycle_started", "Cycle_Started")
        cc_node = _get_cached_node("cycle_completed", "Cycle_Completed")

        nodes = [(k, n) for k, n in [
            ("program_started", ps_node),
            ("cycle_started", cs_node),
            ("cycle_completed", cc_node),
        ] if n is not None]

        if not nodes:
            return _default

        values = client.get_values([n for _, n in nodes])
        result = dict(_default)
        for (key, _), val in zip(nodes, values):
            result[key] = _coerce_bool(val, key)
        return result

    except Exception as e:
        print("Failed reading program tags:", e)
        return _default


def get_paths():
    defaults = _default_paths()

    if not is_connected():
        return defaults

    try:
        _require_connection()
        _ensure_browse_name_index()

        # Collect all available nodes and their metadata in one pass
        read_items = []  # list of (path_num, field, node)

        for idx in range(4):
            path_num = idx + 1

            passes_node = _path_pass_nodes.get(path_num)
            if passes_node is None:
                passes_node = find_node_by_browse_name(_objects_node, f"Path{path_num}_Num_Passes")
                if passes_node is None:
                    _log_missing_node_once(f"Path{path_num}_Num_Passes")
                else:
                    _path_pass_nodes[path_num] = passes_node
            if passes_node is not None:
                read_items.append((path_num, "passes", passes_node))

            force_node = _path_force_nodes.get(path_num)
            if force_node is None:
                force_node = find_node_by_browse_name(_objects_node, f"Pass{path_num}_Force")
                if force_node is None:
                    _log_missing_node_once(f"Pass{path_num}_Force")
                else:
                    _path_force_nodes[path_num] = force_node
            if force_node is not None:
                read_items.append((path_num, "force", force_node))

            if path_num <= 3:
                grit_node = _path_grit_nodes.get(path_num)
                if grit_node is None:
                    grit_node = find_node_by_browse_name(_objects_node, f"Path{path_num}_Grit")
                    if grit_node is None:
                        _log_missing_node_once(f"Path{path_num}_Grit")
                    else:
                        _path_grit_nodes[path_num] = grit_node
                if grit_node is not None:
                    read_items.append((path_num, "grit", grit_node))

        result = [dict(d) for d in defaults]

        if read_items:
            raw_values = client.get_values([node for _, _, node in read_items])

            for (path_num, field, _), raw in zip(read_items, raw_values):
                idx = path_num - 1
                d = defaults[idx]
                if field == "passes":
                    v = _safe_int(raw, d["passes"])
                    result[idx]["passes"] = max(0, v if v is not None else d["passes"])
                elif field == "force":
                    v = _safe_float(raw, d["force"])
                    v = v if v is not None else d["force"]
                    result[idx]["force"] = max(0, min(20, v))
                elif field == "grit":
                    v = _safe_int(raw, d["grit"])
                    result[idx]["grit"] = v if v in (80, 120, 180) else d["grit"]

        return result

    except Exception as e:
        print("Failed reading paths:", e)
        return defaults


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

    write_part_name(part_id.replace("_", " "))


def write_paths(paths):
    _require_connection()
    _ensure_browse_name_index()

    if not isinstance(paths, list):
        raise ValueError("paths must be a list")

    for idx in range(4):
        path_num = idx + 1
        path_data = paths[idx] if idx < len(paths) and isinstance(paths[idx], dict) else {}

        passes_node_name = f"Path{path_num}_Num_Passes"
        passes_node = _path_pass_nodes.get(path_num)
        if passes_node is None:
            passes_node = find_node_by_browse_name(_objects_node, passes_node_name)
            if passes_node is None:
                _log_missing_node_once(passes_node_name)
            else:
                _path_pass_nodes[path_num] = passes_node

        passes_value = path_data.get("passes", 0)
        try:
            passes_value = max(0, int(passes_value))
        except Exception:
            passes_value = 0

        if passes_node is not None:
            _set_node_value(passes_node, passes_value, passes_node_name)

        force_node_name = f"Pass{path_num}_Force"
        force_node = _path_force_nodes.get(path_num)
        if force_node is None:
            force_node = find_node_by_browse_name(_objects_node, force_node_name)
            if force_node is None:
                _log_missing_node_once(force_node_name)
            else:
                _path_force_nodes[path_num] = force_node

        force_value = path_data.get("force", 10)
        try:
            force_value = max(0, min(20, float(force_value)))
        except Exception:
            force_value = 10.0

        if force_node is not None:
            _set_node_value(force_node, force_value, force_node_name)

        if path_num <= 3:
            grit_node_name = f"Path{path_num}_Grit"
            grit_node = _path_grit_nodes.get(path_num)
            if grit_node is None:
                grit_node = find_node_by_browse_name(_objects_node, grit_node_name)
                if grit_node is None:
                    _log_missing_node_once(grit_node_name)
                else:
                    _path_grit_nodes[path_num] = grit_node

            grit_value = path_data.get("grit", 80 if path_num == 1 else 120 if path_num == 2 else 180)
            try:
                grit_value = int(grit_value)
            except Exception:
                grit_value = 80 if path_num == 1 else 120 if path_num == 2 else 180

            if grit_node is not None:
                _set_node_value(grit_node, grit_value, grit_node_name)
                
def write_user_name(user_name: str):
    _require_connection()

    user_node = _get_cached_node("user_name", "UserName")
    if user_node is None:
        print("Skipping missing OPC node: UserName")
        return

    _set_node_value(user_node, str(user_name), "UserName")
    
def write_part_name(part_id: str):
    _require_connection()

    part_node = _get_cached_node("part_name", "part_name")
    if part_node is None:
        print("Skipping missing OPC node: part_name")
        return

    _set_node_value(part_node, str(part_id), "part_name")

def write_recipe_name(recipe_name: str):
    _require_connection()

    recipe_node = _get_cached_node("recipe_name", "Recipe_Name")
    if recipe_node is None:
        print("Skipping missing OPC node: Recipe_Name")
        return

    _set_node_value(recipe_node, str(recipe_name), "Recipe_Name")
    
def write_zone_list(zone_ids: list[int]):
    _require_connection()

    zone_list_node = _get_cached_node("zone_list", "Zone_List")
    if zone_list_node is None:
        print("Skipping missing OPC node: Zone_List")
        return

    if not zone_ids:
        zone_list_value = ""
    else:
        zone_list_value = ",".join(str(i) for i in sorted(zone_ids))

    _set_node_value(zone_list_node, zone_list_value, "Zone_List")
    
def write_shift_start_time(value: str):
    _require_connection()

    node = _get_cached_node("shift_start_time", "Shift_Start_Time")
    if node is None:
        print("Skipping missing OPC node: Shift_Start_Time")
        return

    _set_node_value(node, str(value), "Shift_Start_Time")


def write_shift_end_time(value: str):
    _require_connection()

    node = _get_cached_node("shift_end_time", "Shift_End_Time")
    if node is None:
        print("Skipping missing OPC node: Shift_End_Time")
        return

    _set_node_value(node, str(value), "Shift_End_Time")


def write_shift_completed(value: int):
    _require_connection()

    node = _get_cached_node("shift_completed", "Shift_Completed")
    if node is None:
        print("Skipping missing OPC node: Shift_Completed")
        return

    _set_node_value(node, int(value), "Shift_Completed")


def write_shift_started(value: int):
    _require_connection()

    node = _get_cached_node("shift_started", "Shift_Started")
    if node is None:
        print("Skipping missing OPC node: Shift_Started")
        return

    _set_node_value(node, int(value), "Shift_Started")


_reconnect_stop = threading.Event()


def _keepalive() -> None:
    """Verify OPC session is still alive with a cheap server read.
    Marks connected=False if the call fails so the reconnect loop can take over."""
    global connected
    if not is_connected():
        return
    try:
        client.get_namespace_array()
    except Exception as e:
        print(f"OPC keepalive failed, marking disconnected: {e}")
        connected = False


def _reconnect_worker():
    while not _reconnect_stop.wait(10):
        if not is_connected():
            print("OPC reconnect attempt...")
            connect()
        else:
            _keepalive()


def start_reconnect_loop():
    _reconnect_stop.clear()
    t = threading.Thread(target=_reconnect_worker, daemon=True)
    t.start()