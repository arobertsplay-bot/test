
import {
  Adb,
  AdbDaemonTransport
} from "@yume-chan/adb";

import {
  AdbDaemonWebUsbDeviceManager
} from "@yume-chan/adb-daemon-webusb";

import AdbWebCredentialStore
  from "@yume-chan/adb-credential-web";

let adb = null;
let timer = null;
let capturing = false;
let imageUrl = null;

const $ = id => document.getElementById(id);
const logBox = $("log");

function report(message) {
  const time = new Date().toLocaleTimeString();

  if (logBox.textContent === "Waiting...") {
    logBox.textContent = "";
  }

  logBox.textContent += `[${time}] ${message}\n`;
  logBox.scrollTop = logBox.scrollHeight;

  $("status").textContent = message;
  console.log(message);
}

$("connect").onclick = async () => {
  $("connect").disabled = true;

  try {
    report("Checking WebUSB");

    const manager =
      AdbDaemonWebUsbDeviceManager.BROWSER;

    if (!manager) {
      throw new Error(
        "WebUSB unavailable. Use desktop Chrome."
      );
    }

    report("Select your Pixel 9");

    const device = await manager.requestDevice();

    if (!device) {
      report("Device selection cancelled");
      return;
    }

    report("Opening USB connection");

    const connection = await device.connect();

    report("USB connected");

    const credentialStore =
      new AdbWebCredentialStore(
        "Pocket Controller"
      );

    report("Starting ADB authentication");

    const transport =
      await AdbDaemonTransport.authenticate({
        serial: device.serial,
        connection,
        credentialStore
      });

    report("ADB authentication successful");

    adb = new Adb(transport);

    const result =
      await adb.subprocess.shellProtocol
        .spawnWaitText(["wm", "size"]);

    if (result.exitCode !== 0) {
      throw new Error(
        result.stderr || "Screen size command failed"
      );
    }

    report("Connected: " + result.stdout.trim());

    $("capture").disabled = false;
    $("monitor").disabled = false;

  } catch (error) {
    report("ERROR: " + error.message);
    console.error(error);
  } finally {
    if (!adb) {
      $("connect").disabled = false;
    }
  }
};

async function captureScreen() {
  if (!adb || capturing) return;

  capturing = true;

  try {
    const result =
      await adb.subprocess.shellProtocol
        .spawnWait(["screencap", "-p"]);

    if (result.exitCode !== 0) {
      throw new Error("Screenshot command failed");
    }

    const blob = new Blob(
      [result.stdout],
      { type: "image/png" }
    );

    const newUrl = URL.createObjectURL(blob);
    const previousUrl = imageUrl;

    const image = $("screen");

    image.onload = () => {
      if (previousUrl) {
        URL.revokeObjectURL(previousUrl);
      }
    };

    image.src = newUrl;
    imageUrl = newUrl;

    report("Screenshot captured");

  } catch (error) {
    report("Capture error: " + error.message);
    console.error(error);
  } finally {
    capturing = false;
  }
}

$("capture").onclick = captureScreen;

$("monitor").onclick = () => {
  if (!adb || timer) return;

  report("Monitoring started");

  captureScreen();

  timer = setInterval(captureScreen, 4000);

  $("monitor").disabled = true;
  $("stop").disabled = false;
};

$("stop").onclick = () => {
  clearInterval(timer);
  timer = null;

  $("monitor").disabled = false;
  $("stop").disabled = true;

  report("Monitoring stopped");
};

report("Ready to connect");
