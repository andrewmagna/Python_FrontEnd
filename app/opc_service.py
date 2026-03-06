from opcua import Client
from app.config_store import load_config

client = None
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

        connected = False
        print("OPC connection failed:", e)


def is_connected():
    return connected


def write_zones(part_id, zones):

    if not connected:
        raise Exception("OPC not connected")

    root = client.get_root_node()
    objects = root.get_child(["0:Objects"])

    for i in range(1,41):

        node = objects.get_child([f"2:Zone_{i}_CMD"])
        val = 1 if zones.get(str(i)) or zones.get(i) else 0

        node.set_value(val)

    part_node = objects.get_child(["2:part_name"])
    part_node.set_value(part_id)