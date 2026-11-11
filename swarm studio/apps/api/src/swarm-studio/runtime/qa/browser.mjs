import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";

function send(event) {
  process.stdout.write(JSON.stringify(event) + "\n");
}

const mobile = process.argv.includes("--mobile");
const viewport = mobile ? { width: 390, height: 680 } : { width: 960, height: 620 };
const browser = await chromium.launch({
  headless: true,
  ...(process.env.QA_CHROMIUM_PATH ? { executablePath: process.env.QA_CHROMIUM_PATH } : {}),
  args: ["--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport, isMobile: mobile, hasTouch: mobile });
page.setDefaultTimeout(5_000);
page.setDefaultNavigationTimeout(12_000);
const errors = [];
page.on("pageerror", (error) => {
  errors.push(error.message.slice(0, 400));
  if (errors.length > 8) errors.shift();
});

let previous;
let capturing = false;
let preview = page;
const readyPages = new WeakSet();
async function capture() {
  const current = preview;
  if (
    capturing ||
    current.isClosed() ||
    !readyPages.has(current) ||
    !/^https?:\/\//.test(current.url())
  ) {
    return;
  }
  capturing = true;
  try {
    const frame = await current.screenshot({ timeout: 2_000 });
    if (current !== preview || !readyPages.has(current) || !/^https?:\/\//.test(current.url())) {
      return;
    }
    if (frame.length <= 1_500_000 && !previous?.equals(frame)) {
      previous = frame;
      send({ type: "frame", image: frame.toString("base64") });
    }
  } catch {
    // An in-progress navigation can invalidate the capture. The next tick tries again.
  } finally {
    capturing = false;
  }
}

async function showPointer(tab, point, pressed) {
  await tab
    .evaluate(
      ({ point, pressed }) => {
        const id = "__swarm_studio_qa_pointer";
        let marker = document.getElementById(id);
        if (!marker) {
          marker = document.createElement("span");
          marker.id = id;
          marker.setAttribute("aria-hidden", "true");
          const root = marker.attachShadow({ mode: "closed" });
          const cursor = document.createElement("span");
          Object.assign(cursor.style, {
            position: "absolute",
            left: "13px",
            top: "13px",
            width: "17px",
            height: "22px",
            background: "white",
            filter: "drop-shadow(0 1px 2px black)",
            clipPath: "polygon(0 0, 95% 65%, 59% 67%, 79% 95%, 59% 100%, 39% 73%, 13% 97%)",
          });
          root.append(cursor);
          document.documentElement.append(marker);
        }
        Object.assign(marker.style, {
          position: "fixed",
          zIndex: "2147483647",
          pointerEvents: "none",
          boxSizing: "border-box",
          left: `${point.x}px`,
          top: `${point.y}px`,
          width: "30px",
          height: "30px",
          borderRadius: "50%",
          transform: "translate(-50%, -50%)",
          border: "3px solid gold",
          boxShadow: "0 0 0 2px black",
          background: pressed ? "rgb(255 215 0 / 55%)" : "transparent",
        });
      },
      { point, pressed },
    )
    .catch(() => {});
}

async function previewControl(tab, control) {
  try {
    await control.scrollIntoViewIfNeeded({ timeout: 1_500 });
    const bounds = await control.boundingBox({ timeout: 1_500 });
    if (!bounds) return;
    const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    await showPointer(tab, point, false);
    await capture();
    await delay(550);
    return point;
  } catch {
    // The browser action still runs through Playwright if the target moves or disappears.
  }
}

async function inspect() {
  const body = page.locator("body");
  const title = await page.title();
  const controls = await body.ariaSnapshot({ timeout: 3_000 });
  const content = await body.innerText({ timeout: 3_000 });
  return {
    url: page.url(),
    title,
    controls: controls.slice(0, 6_000),
    text: content.slice(0, 3_000),
    errors: [...errors],
  };
}

function webUrl(target) {
  const url = new URL(target);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Use an HTTP or HTTPS URL.");
  return url.href;
}

async function openPage(tab, url) {
  readyPages.delete(tab);
  await tab.goto(url, { waitUntil: "domcontentloaded" });
  readyPages.add(tab);
}

async function reloadPage(tab) {
  readyPages.delete(tab);
  await tab.reload({ waitUntil: "domcontentloaded" });
  readyPages.add(tab);
}

async function stress(selector, count) {
  const url = webUrl(page.url());
  const clients = Number(count);
  if (!Number.isInteger(clients) || clients < 2 || clients > 6) {
    throw new Error("Set the number of parallel sessions to an integer from 2 to 6.");
  }
  const tabs = [];
  try {
    for (let index = 0; index < clients; index++) {
      tabs.push(await browser.newPage({ viewport }));
    }
    await Promise.all(tabs.map((tab) => openPage(tab, url)));
    preview = tabs[0];
    const pointer = await previewControl(preview, preview.locator(selector));
    if (pointer) await showPointer(preview, pointer, true);
    const outcomes = await Promise.allSettled(
      tabs.map(async (tab) => {
        const started = performance.now();
        const mutations = [];
        tab.on("response", (response) => {
          if (response.request().method() === "POST" && mutations.length < 6) {
            const url = new URL(response.url());
            mutations.push({ path: url.pathname, status: response.status() });
          }
        });
        await tab.locator(selector).click({ timeout: 5_000 });
        await tab.waitForLoadState("networkidle", { timeout: 2_000 }).catch(() => {});
        return { elapsedMs: Math.round(performance.now() - started), mutations };
      }),
    );
    await capture();
    await delay(500);
    preview = page;
    await reloadPage(page);
    await page.waitForLoadState("networkidle", { timeout: 2_000 }).catch(() => {});
    return {
      ...(await inspect()),
      sessions: outcomes.map((outcome, index) =>
        outcome.status === "fulfilled"
          ? { session: index + 1, ...outcome.value }
          : { session: index + 1, error: outcome.reason.message.slice(0, 400) },
      ),
    };
  } finally {
    preview = page;
    await Promise.allSettled(tabs.map((tab) => tab.close()));
  }
}

async function step({ action, target, value }) {
  if (action === "open") await openPage(page, webUrl(target));
  else if (action === "reload") await reloadPage(page);
  else if (action === "stress") return stress(target, value);
  else if (action === "wait_for_text")
    await page.getByText(value, { exact: true }).first().waitFor();
  else if (action !== "inspect") {
    const control = page.locator(target);
    const pointer = await previewControl(page, control);
    if (pointer) await showPointer(page, pointer, true);
    if (action === "click") await control.click();
    else if (action === "double_click") await control.dblclick();
    else if (action === "fill") await control.fill(value);
    else if (action === "press") await control.press(value);
    else throw new Error("Unknown browser action.");
    if (pointer) {
      await capture();
      await delay(450);
    }
  }
  if (action !== "inspect") {
    await page.waitForLoadState("networkidle", { timeout: 1_200 }).catch(() => {});
  }
  return inspect();
}

const frames = setInterval(() => {
  void capture();
}, 180);
const input = createInterface({ input: process.stdin, terminal: false });
send({ type: "ready" });
try {
  for await (const line of input) {
    let id;
    try {
      const command = JSON.parse(line);
      id = command.id;
      const result = await step(command);
      await capture();
      send({ type: "result", id, result });
    } catch (error) {
      await capture();
      send({ type: "result", id, error: error.message });
    }
  }
} finally {
  clearInterval(frames);
  await browser.close();
}
