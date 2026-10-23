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

function fixture(){const real=window.fetch.bind(window);window.__contactSubmissions=0;window.fetch=async(input,init={})=>{const u=new URL(typeof input==='string'?input:input.url);if(u.hostname!=='api.srtechcreators.in')return real(input,init);let data=null;if(u.pathname.endsWith('/public/content'))data=[{key:'contact_phone',title:'Contact',body:'+917730020465'},{key:'privacy',title:'Privacy policy',body:'Fixture approved policy for browser testing.'}];if(u.pathname.endsWith('/public/contact')){const body=JSON.parse(init.body);if(!body.consent)throw Error('Consent missing');window.__contactSubmissions++;data={message:'Fixture enquiry received'};}return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});};}

(async () => {
  try {
    fs.mkdirSync(path.join(root, "build", "screenshots"), { recursive: true });
    server = spawn(
      process.execPath,
      [
        path.join(root, "frontend/website/node_modules/vite/bin/vite.js"),
        "preview",
        "--host",
        "127.0.0.1",
        "--port",
        "4173",
        "--strictPort",
      ],
      {
        cwd: path.join(root, "frontend/website"),
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
        "--remote-debugging-port=9339",
        `--user-data-dir=${path.join(root, ".browser-website-check")}`,
        "about:blank",
      ],
      { windowsHide: true, stdio: "ignore" },
    );
    const targets = await (
      await poll("http://127.0.0.1:9339/json/list")
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

    await command('Page.addScriptToEvaluateOnNewDocument',{source:'('+fixture.toString()+')()'});
    const shots=path.join(root,'frontend/website/screenshots');fs.mkdirSync(shots,{recursive:true});
    for(const [name,width,height]of [['desktop',1440,1000],['mobile',390,844]]){
      await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:name==='mobile'});await command('Page.navigate',{url:'http://127.0.0.1:4173'});
      for(let i=0;i<80;i++){if((await evaluate('document.body.innerText')).includes('Send enquiry'))break;await pause(200);}
      assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'),true,name+' overflow');
      assert.equal(await evaluate("document.querySelectorAll('[role=alert]').length"),0);
      for(let i=0;i<30;i++){if(await evaluate('Array.from(document.images).every(i=>i.complete&&i.naturalWidth>0)'))break;await pause(200);}
      assert.equal(await evaluate('Array.from(document.images).every(i=>i.complete&&i.naturalWidth>0)'),true);
      assert.equal(await evaluate("document.querySelector('form').checkValidity()"),false);
      await evaluate("(()=>{const b=document.createElement('div');b.textContent='UI fixture ? not hosted enquiries or downloads';b.style='position:fixed;bottom:0;right:0;z-index:100;background:#fff;padding:6px;font:10px sans-serif';document.body.appendChild(b)})()");
      const metrics=await command('Page.getLayoutMetrics');const image=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width,height:metrics.cssContentSize.height,scale:1}});fs.writeFileSync(path.join(shots,name+'.png'),Buffer.from(image.data,'base64'));
      console.log('PASS website '+name+': images, responsive layout, form constraints and screenshot');
    }
    await evaluate(`(()=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(const [name,value]of [['name','Fixture visitor'],['email','visitor@example.invalid']]){const e=document.querySelector('input[name='+name+']');setter.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));}const t=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'Please explain how booking works.');t.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('input[name=consent]').click();document.querySelector('form button').click();})()`);
    for(let i=0;i<50;i++){if((await evaluate('document.body.innerText')).includes('Fixture enquiry received'))break;await pause(200);}
    assert.equal(await evaluate('window.__contactSubmissions'),1);
    assert.deepEqual(errors,[]);fs.writeFileSync(path.join(root,'build/website-ui.json'),JSON.stringify({kind:'React website with local fixture API, not hosted delivery',viewports:['1440x1000','390x844'],contactForm:true,exceptions:errors},null,2));console.log('PASS website contact consent and fixture submission; no hosted message sent.');
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
