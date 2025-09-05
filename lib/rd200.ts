export const SERVICE_UUID = "000015231212efde1523785feabcd123";
export const TRIGGER_UID = "000015241212efde1523785feabcd123";
export const DATA_UUID = "000015251212efde1523785feabcd123";


export const RADONEYE_BLUETOOTH_COMPANY_ID = "f24be3";

export const RD200 = "R20"; // RadonEye First Generation BLE
export const TRIGGER_DATA: number[] = [0x50];


/*

private String getSerial(BluetoothDiscoveryDevice device) {
    String name = device.getName();
    String[] parts = name.split(":");
    if (parts.length == 3) {
        return parts[2];
    } else {
        return "";
    }
}

private String getManufacturer(BluetoothDiscoveryDevice device) {
    String name = device.getName();
    String[] parts = name.split(":");
    if (parts.length == 3) {
        return parts[0];
    } else {
        return "";
    }
}

private String getModel(BluetoothDiscoveryDevice device) {
    String name = device.getName();
    String[] parts = name.split(":");
    if (parts.length == 3) {
        return parts[1];
    } else {
        return "";
    }
}

*/