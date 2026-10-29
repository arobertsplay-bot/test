
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


 // TOUCHSCREEN CONTROL: TAP, SWIPE AND DRAG

const screenImage = $("screen");

screenImage.style.cursor = "crosshair";
screenImage.style.touchAction = "none";

let pointerStart = null;
let gestureBusy = false;

function getPhoneCoordinates(event) {
  const image = screenImage;

  if (!image.naturalWidth || !image.naturalHeight) {
    throw new Error("Capture a screenshot first");
  }

  const rect = image.getBoundingClientRect();

  const imageRatio =
    image.naturalWidth / image.naturalHeight;

  const boxRatio = rect.width / rect.height;

  let displayedWidth = rect.width;
  let displayedHeight = rect.height;
  let offsetX = 0;
  let offsetY = 0;

  if (getComputedStyle(image).objectFit === "contain") {
    if (boxRatio > imageRatio) {
      displayedWidth = rect.height * imageRatio;
      offsetX = (rect.width - displayedWidth) / 2;
    } else {
      displayedHeight = rect.width / imageRatio;
      offsetY = (rect.height - displayedHeight) / 2;
    }
  }

  const relativeX =
    (event.clientX - rect.left - offsetX) /
    displayedWidth;

  const relativeY =
    (event.clientY - rect.top - offsetY) /
    displayedHeight;

  return {
    x: Math.max(
      0,
      Math.min(
        screenWidth - 1,
        Math.round(relativeX * screenWidth)
      )
    ),
    y: Math.max(
      0,
      Math.min(
        screenHeight - 1,
        Math.round(relativeY * screenHeight)
      )
    )
  };
}

screenImage.addEventListener("pointerdown", event => {
  if (!adb || gestureBusy || event.button !== 0) return;

  try {
    pointerStart = {
      ...getPhoneCoordinates(event),
      time: Date.now(),
      pointerId: event.pointerId
    };

    screenImage.setPointerCapture(event.pointerId);
    event.preventDefault();
  } catch (error) {
    report("Gesture error: " + error.message);
  }
});

screenImage.addEventListener("pointerup", async event => {
  if (!adb || !pointerStart || gestureBusy) return;

  if (event.pointerId !== pointerStart.pointerId) return;

  const start = pointerStart;
  pointerStart = null;

  let end;

  try {
    end = getPhoneCoordinates(event);
  } catch (error) {
    report("Gesture error: " + error.message);
    return;
  }

  const distance = Math.hypot(
    end.x - start.x,
    end.y - start.y
  );

  const duration = Date.now() - start.time;

  gestureBusy = true;

  try {
    let args;

    if (distance < 25 && duration < 500) {
      args = [
        "input",
        "tap",
        String(start.x),
        String(start.y)
      ];

      report(`Tapping ${start.x}, ${start.y}`);
    } else {
      const swipeDuration = Math.max(
        150,
        Math.min(1500, duration)
      );

      args = [
        "input",
        "swipe",
        String(start.x),
        String(start.y),
        String(end.x),
        String(end.y),
        String(swipeDuration)
      ];

      report(
        `Swiping ${start.x},${start.y} ` +
        `to ${end.x},${end.y}`
      );
    }

    const result =
      await adb.subprocess.shellProtocol
        .spawnWaitText(args);

    if (result.exitCode !== 0) {
      throw new Error(
        result.stderr || "Gesture command failed"
      );
    }

    report("Gesture successful");

    await new Promise(resolve =>
      setTimeout(resolve, 600)
    );

    await captureScreen();

  } catch (error) {
    report("Gesture error: " + error.message);
    console.error(error);
  } finally {
    gestureBusy = false;
  }
});

screenImage.addEventListener("pointercancel", () => {
  pointerStart = null;
});


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
