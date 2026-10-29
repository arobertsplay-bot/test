
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
let tapping = false;
let imageUrl = null;

let screenWidth = 1080;
let screenHeight = 2424;

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

// CONNECT TO PIXEL

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

    const sizeText = result.stdout.trim();

    const sizeMatch =
      sizeText.match(/(\d+)\s*x\s*(\d+)/);

    if (sizeMatch) {
      screenWidth = Number(sizeMatch[1]);
      screenHeight = Number(sizeMatch[2]);
    }

    report("Connected: " + sizeText);

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

// CAPTURE PHONE SCREEN

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

    image.style.cursor = "crosshair";

    report("Screenshot captured");

  } catch (error) {
    report("Capture error: " + error.message);
    console.error(error);
  } finally {
    capturing = false;
  }
}

$("capture").onclick = captureScreen;

// TAP PHONE BY CLICKING SCREENSHOT

$("screen").onclick = async event => {
  if (!adb || tapping) return;

  const image = $("screen");

  if (!image.naturalWidth || !image.naturalHeight) {
    report("No screenshot available");
    return;
  }

  const rect = image.getBoundingClientRect();

  // Account for any CSS object-fit scaling.
  const imageRatio =
    image.naturalWidth / image.naturalHeight;

  const boxRatio =
    rect.width / rect.height;

  let displayedWidth = rect.width;
  let displayedHeight = rect.height;
  let offsetX = 0;
  let offsetY = 0;

  if (
    getComputedStyle(image).objectFit === "contain"
  ) {
    if (boxRatio > imageRatio) {
      displayedWidth = rect.height * imageRatio;
      offsetX = (rect.width - displayedWidth) / 2;
    } else {
      displayedHeight = rect.width / imageRatio;
      offsetY = (rect.height - displayedHeight) / 2;
    }
  }

  const relativeX =
    (event.clientX - rect.left - offsetX)
    / displayedWidth;

  const relativeY =
    (event.clientY - rect.top - offsetY)
    / displayedHeight;

  if (
    relativeX < 0 || relativeX > 1 ||
    relativeY < 0 || relativeY > 1
  ) {
    report("Click outside phone screen");
    return;
  }

  const x = Math.max(
    0,
    Math.min(
      screenWidth - 1,
      Math.round(relativeX * screenWidth)
    )
  );

  const y = Math.max(
    0,
    Math.min(
      screenHeight - 1,
      Math.round(relativeY * screenHeight)
    )
  );

  tapping = true;

  try {
    report(`Tapping phone at ${x}, ${y}`);

    const result =
      await adb.subprocess.shellProtocol
        .spawnWaitText([
          "input",
          "tap",
          String(x),
          String(y)
        ]);

    if (result.exitCode !== 0) {
      throw new Error(
        result.stderr || "Tap command failed"
      );
    }

    report(`Tap successful: ${x}, ${y}`);

    // Allow the game to respond before capturing.
    await new Promise(resolve =>
      setTimeout(resolve, 500)
    );

    await captureScreen();

  } catch (error) {
    report("Tap error: " + error.message);
    console.error(error);
  } finally {
    tapping = false;
  }
};

// MONITOR SCREEN

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
