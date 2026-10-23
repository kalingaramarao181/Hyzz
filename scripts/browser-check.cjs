// A dependency-light Chrome DevTools check of the built admin login page.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const WebSocket = require("ws");
const assert = require("node:assert/strict");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome =
  process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const root = path.resolve(__dirname, "..");
let browser, server, ws;
let next = 0;
const pending = new Map();
const errors = [];
async function poll(url) {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return r;
    } catch {}
    await pause(250);
  }
  throw new Error(`Not ready: ${url}`);
}
function command(method, params = {}) {
  const id = ++next;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }
    }, 15000).unref();
  });
}
async function evaluate(expression) {
  const r = await command("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
}
(async () => {
  try {
    fs.mkdirSync(path.join(root, "build", "screenshots"), { recursive: true });
    server = spawn(
      process.execPath,
      [
        path.join(root, "frontend/admin/node_modules/vite/bin/vite.js"),
        "preview",
        "--host",
        "127.0.0.1",
        "--port",
        "4173",
        "--strictPort",
      ],
      {
        cwd: path.join(root, "frontend/admin"),
        windowsHide: true,
        stdio: "ignore",
      },
    );
    await poll("http://127.0.0.1:4173");
    browser = spawn(
      chrome,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--remote-debugging-port=9333",
        `--user-data-dir=${path.join(root, ".browser-check")}`,
        "about:blank",
      ],
      { windowsHide: true, stdio: "ignore" },
    );
    const targets = await (
      await poll("http://127.0.0.1:9333/json/list")
    ).json();
    const target = targets.find((t) => t.type === "page");
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r, j) => {
      ws.once("open", r);
      ws.once("error", j);
    });
    ws.on("message", (raw) => {
      const m = JSON.parse(raw);
      if (m.id) {
        const p = pending.get(m.id);
        if (p) {
          pending.delete(m.id);
          m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
        }
      } else if (m.method === "Runtime.exceptionThrown")
        errors.push(m.params.exceptionDetails.text);
    });
    await command("Page.enable");
    await command("Runtime.enable");
    for (const [name, width, height] of [
      ["desktop", 1440, 1000],
      ["mobile", 390, 844],
    ]) {
      await command("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: name === "mobile",
      });
      await command("Page.navigate", { url: "http://127.0.0.1:4173" });
      for (let attempt = 0; attempt < 60; attempt++) {
        if (await evaluate("!!document.querySelector('input[type=email]')")) break;
        await pause(500);
      }
      assert.equal(await evaluate("document.title"), "Hyzz · Operations");
      for(let attempt=0;attempt<40;attempt++){
        if(await evaluate('Array.from(document.images).every(i=>i.complete&&i.naturalWidth>0)'))break;
        await pause(250);
      }
      assert.equal(await evaluate("document.querySelectorAll('.hyzz-brand img,.journey-art').length"),2);
      assert.equal(await evaluate('Array.from(document.images).every(i=>i.complete&&i.naturalWidth>0)'),true,`${name}: brand images did not load`);
      assert.ok(
        (await evaluate("document.body.innerText")).includes("Welcome back."), `${name}: login did not render`,
      );
      assert.equal(
        await evaluate(
          "document.documentElement.scrollWidth<=window.innerWidth",
        ),
        true,
        `${name} horizontal overflow`,
      );
      assert.equal(
        await evaluate(
          "(()=>{const i=document.querySelector('input[type=email]');i.value='invalid';return i.checkValidity();})()",
        ),
        false,
      );
      await evaluate("document.querySelector('input[type=email]').value=''");
      const image = await command("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: true,
      });
      fs.writeFileSync(
        path.join(root, "build", "screenshots", `admin-${name}.png`),
        Buffer.from(image.data, "base64"),
      );
      console.log(
        `PASS admin ${name}: rendered, no horizontal overflow, invalid email rejected; screenshot saved.`,
      );
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS no uncaught browser runtime exceptions. Authenticated admin/device journeys remain untested.",
    );
  } catch (e) {
    console.error(e.message);
    if (ws?.readyState === WebSocket.OPEN) console.error(await evaluate('document.body.innerText').catch(()=>''));
    console.error('Browser exceptions:',errors);
    process.exitCode = 1;
  } finally {
    if(ws?.readyState === WebSocket.OPEN) await command('Browser.close').catch(()=>{});
    ws?.close();
    browser?.kill();
    server?.kill();
  }
})();
