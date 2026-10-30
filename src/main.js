
import { createBattleDetector } from "./battle-detector.js";

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
let gestureBusy = false;
let energyBusy = false;
let imageUrl = null;
let detectBattle = null;

let screenWidth = 1080;
let screenHeight = 2424;

const $ = id => document.getElementById(id);
const logBox = $("log");
const screenImage = $("screen");

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function setButtonState() {
  $("connect").disabled = Boolean(adb);
  $("capture").disabled = !adb;
  $("monitor").disabled = !adb || Boolean(timer);
  $("stop").disabled = !timer;

  const energyButton = $("test-energy");

  if (energyButton) {
    energyButton.disabled = !adb || energyBusy || gestureBusy;
  }
}

async function runCommand(args) {
  if (!adb) throw new Error("Pixel 9 is not connected");

  const result = await adb.subprocess.shellProtocol
    .spawnWaitText(args);

  if (result.exitCode !== 0) {
    throw new Error(
      result.stderr || `Command failed: ${args.join(" ")}`
    );
  }

  return result;
}

async function tap(x, y) {
  return runCommand([
    "input", "tap",
    String(Math.round(x)),
    String(Math.round(y))
  ]);
}

async function swipe(x1, y1, x2, y2, duration = 500) {
  return runCommand([
    "input", "swipe",
    String(Math.round(x1)),
    String(Math.round(y1)),
    String(Math.round(x2)),
    String(Math.round(y2)),
    String(duration)
  ]);
}

function phonePoint(xFraction, yFraction) {
  return {
    x: Math.round(screenWidth * xFraction),
    y: Math.round(screenHeight * yFraction)
  };
}

// CONNECT PIXEL 9

$("connect").onclick = async () => {
  $("connect").disabled = true;

  try {
    report("Checking WebUSB");

    const manager = AdbDaemonWebUsbDeviceManager.BROWSER;

    if (!manager) {
      throw new Error("WebUSB unavailable. Use desktop Chrome.");
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
      new AdbWebCredentialStore("Pocket Controller");

    report("Starting ADB authentication");

    const transport = await AdbDaemonTransport.authenticate({
      serial: device.serial,
      connection,
      credentialStore
    });

    report("ADB authentication successful");

    adb = new Adb(transport);

    const result = await runCommand(["wm", "size"]);
    const sizeText = result.stdout.trim();
    const match = sizeText.match(/(\d+)\s*x\s*(\d+)/);

    if (match) {
      screenWidth = Number(match[1]);
      screenHeight = Number(match[2]);
    }

    report("Connected: " + sizeText);

  } catch (error) {
    report("ERROR: " + error.message);
    console.error(error);
  } finally {
    setButtonState();
  }
};

// CAPTURE SCREEN

async function captureScreen() {
  if (!adb || capturing) return false;

  capturing = true;

  try {
    const result = await adb.subprocess.shellProtocol
      .spawnWait(["screencap", "-p"]);

    if (result.exitCode !== 0) {
      throw new Error("Screenshot command failed");
    }

    const blob = new Blob(
      [result.stdout],
      { type: "image/png" }
    );

    const newUrl = URL.createObjectURL(blob);
    const oldUrl = imageUrl;

    await new Promise((resolve, reject) => {
      screenImage.onload = resolve;
      screenImage.onerror = reject;
      screenImage.src = newUrl;
    });

    imageUrl = newUrl;

    if (oldUrl) URL.revokeObjectURL(oldUrl);

    report("Screenshot captured");
    return true;

  } catch (error) {
    report("Capture error: " + error.message);
    console.error(error);
    return false;
  } finally {
    capturing = false;
  }
}

$("capture").onclick = captureScreen;

// MANUAL TOUCHSCREEN CONTROL

screenImage.style.cursor = "crosshair";
screenImage.style.touchAction = "none";

let pointerStart = null;

function getPhoneCoordinates(event) {
  if (!screenImage.naturalWidth || !screenImage.naturalHeight) {
    throw new Error("Capture a screenshot first");
  }

  const rect = screenImage.getBoundingClientRect();

  const imageRatio =
    screenImage.naturalWidth / screenImage.naturalHeight;

  const boxRatio = rect.width / rect.height;

  let displayedWidth = rect.width;
  let displayedHeight = rect.height;
  let offsetX = 0;
  let offsetY = 0;

  if (getComputedStyle(screenImage).objectFit === "contain") {
    if (boxRatio > imageRatio) {
      displayedWidth = rect.height * imageRatio;
      offsetX = (rect.width - displayedWidth) / 2;
    } else {
      displayedHeight = rect.width / imageRatio;
      offsetY = (rect.height - displayedHeight) / 2;
    }
  }

  const relativeX =
    (event.clientX - rect.left - offsetX) / displayedWidth;

  const relativeY =
    (event.clientY - rect.top - offsetY) / displayedHeight;

  return {
    x: Math.max(0, Math.min(
      screenWidth - 1,
      Math.round(relativeX * screenWidth)
    )),
    y: Math.max(0, Math.min(
      screenHeight - 1,
      Math.round(relativeY * screenHeight)
    ))
  };
}

screenImage.addEventListener("pointerdown", event => {
  if (!adb || gestureBusy || energyBusy || event.button !== 0) {
    return;
  }

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
  if (!adb || !pointerStart || gestureBusy || energyBusy) return;
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
  setButtonState();

  try {
    if (distance < 25 && duration < 500) {
      report(`Tapping ${start.x}, ${start.y}`);
      await tap(start.x, start.y);
    } else {
      const swipeDuration = Math.max(
        150,
        Math.min(1500, duration)
      );

      report(
        `Swiping ${start.x},${start.y} to ${end.x},${end.y}`
      );

      await swipe(
        start.x, start.y,
        end.x, end.y,
        swipeDuration
      );
    }

    report("Gesture successful");
    await sleep(600);
    await captureScreen();

  } catch (error) {
    report("Gesture error: " + error.message);
    console.error(error);
  } finally {
    gestureBusy = false;
    setButtonState();
  }
});

screenImage.addEventListener("pointercancel", () => {
  pointerStart = null;
});

// BATTLE DETECTOR

createBattleDetector(screenImage, report)
  .then(fn => {
    detectBattle = fn;
    report("Battle detector loaded");
  })
  .catch(error => {
    report("Detector setup error: " + error.message);
  });

const analyseButton = $("analyse");

if (analyseButton) {
  analyseButton.onclick = () => {
    if (!detectBattle) {
      report("Detector not ready");
      return;
    }

    detectBattle();
  };
}

// ENERGY ATTACHMENT TEST

const energyButton = $("test-energy");

if (energyButton) {
  energyButton.onclick = async () => {
    if (!adb) {
      report("Connect Pixel 9 first");
      return;
    }

    if (energyBusy || gestureBusy) return;

    energyBusy = true;
    setButtonState();

    try {
      report("Energy test: capturing current screen");

      const captured = await captureScreen();

      if (!captured) {
        throw new Error("Could not capture current screen");
      }

      // Approximate locations from the user's battle screenshots.
      // Energy icon: bottom-right.
      // Active Pokemon: lower-middle battlefield.
      const source = phonePoint(0.91, 0.85);
      const target = phonePoint(0.50, 0.55);

      report(
        `Dragging Energy from ${source.x},${source.y} ` +
        `to ${target.x},${target.y}`
      );

      await swipe(
        source.x, source.y,
        target.x, target.y,
        700
      );

      await sleep(1000);
      await captureScreen();

      report(
        "Energy gesture completed. Check whether Energy attached."
      );

    } catch (error) {
      report("Energy test error: " + error.message);
      console.error(error);
    } finally {
      energyBusy = false;
      setButtonState();
    }
  };
}

// MONITORING

$("monitor").onclick = () => {
  if (!adb || timer) return;

  report("Monitoring started");

  captureScreen();

  timer = setInterval(captureScreen, 4000);

  setButtonState();
};

$("stop").onclick = () => {
  clearInterval(timer);
  timer = null;

  report("Monitoring stopped");
  setButtonState();
};

// INITIALISE

setButtonState();
report("Ready to connect");
