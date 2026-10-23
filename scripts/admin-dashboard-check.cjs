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

function fixture(){
 const real=window.fetch.bind(window);window.__failOverview=true;window.__apiCalls=[];window.__releaseFixture={items:[],uploaded:false};
 const f=window.__releaseFixture;window.XMLHttpRequest=class{constructor(){this.upload={};this.status=201;}open(method,url){if(method!=="PUT"||!url.startsWith("https://storage.example.invalid/"))throw Error("Unexpected fixture upload target");}send(body){if(body.get("").type!=="application/vnd.android.package-archive")throw Error("Incorrect APK MIME type");f.uploaded=true;setTimeout(()=>this.onload(),10);}};
 const id='11111111-1111-4111-8111-111111111111',user={id,email:'admin-ui@example.invalid',aud:'authenticated',role:'authenticated'};
 window.fetch=async(input,init={})=>{
  const u=new URL(typeof input==='string'?input:input.url);if(u.hostname!=='api.srtechcreators.in')return real(input,init);
  const p=u.pathname;window.__apiCalls.push(p);let data={},status=200;
  if(p.endsWith('/auth/verify'))data={access_token:'fixture-access-token',refresh_token:'fixture-refresh-token',expires_in:3600,token_type:'bearer',user};
  else if(p.endsWith('/auth/user'))data=user;
  else if(p.endsWith('/actions/my_profile'))data={id,full_name:'Fixture Admin',kind:'employee',permissions:['users.manage','drivers.review','staff.manage','bookings.manage','finance.read','finance.manage','support.manage','settings.manage','reports.read','content.manage','releases.manage']};
  else if(p.endsWith('/actions/admin_overview')){if(window.__failOverview)throw new TypeError('Local fixture connection failure');data={users:[],drivers:[],documents:[],employees:[],bookings:[],tickets:[],emergencies:[],ledger:[],audit:[],counts:{},financial:{}};}
  else if(p.endsWith('/admin/releases/upload')){const b=JSON.parse(init.body);f.items=[{id,audience:b.audience,version:b.version,version_code:b.version_code,notes:b.notes,state:'draft',notified:0}];data={id,signedUrl:'https://storage.example.invalid/upload',path:'driver/'+id+'.apk'};}
  else if(p.endsWith('/publish')){f.items[0].state='published';data={published:true,sha256:'a'.repeat(64)};}
  else if(p.endsWith('/actions/admin_app_releases'))data=f.items;
  else if(p.includes('/data/system_settings'))data={match_radius_km:10,request_expiry_seconds:120,maintenance_mode:false};
  else if(p.includes('/data/pricing_rules'))data=[{base_paise:5000,hourly_paise:20000,minimum_paise:15000,day_paise:160000,commission_bps:1500}];
  else if(p.includes('/data/')||p.endsWith('/actions/admin_driver_payouts')||p.endsWith('/actions/admin_live_locations')||['admin_assignable_drivers','admin_content','admin_enquiries','admin_coupons','admin_app_releases'].some(n=>p.endsWith('/actions/'+n)))data=[];
  return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
 };
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
        "--remote-debugging-port=9338",
        `--user-data-dir=${path.join(root, ".browser-admin-dashboard-check")}`,
        "about:blank",
      ],
      { windowsHide: true, stdio: "ignore" },
    );
    const targets = await (
      await poll("http://127.0.0.1:9338/json/list")
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
        errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      else if(m.method==="Page.javascriptDialogOpening")command("Page.handleJavaScriptDialog",{accept:true}).catch(e=>errors.push(e.message));
    });
    await command("Page.enable");
    await command("Runtime.enable");

    await command('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    await command('Page.addScriptToEvaluateOnNewDocument',{source:'('+fixture.toString()+')()'});
    await command('Page.navigate',{url:'http://127.0.0.1:4173'});
    async function waitFor(text){for(let i=0;i<80;i++){if((await evaluate('document.body.innerText')).includes(text))return;await pause(200);}throw Error('Missing '+text);}
    async function click(text){await evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim().includes(${JSON.stringify(text)}));if(!e)throw Error('Missing button');e.click()})()`);}
    async function type(selector,value){await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`);}
    await waitFor('Welcome back.');await type('input[type=email]','admin-ui@example.invalid');await click('Send sign-in code');await waitFor('Email verification code');await type('input[inputmode=numeric]','123456');await click('Verify & sign in');await waitFor('Dashboard data is unavailable');
    assert.equal(await evaluate("!!document.querySelector('.stats')"),false);
    await evaluate('window.__failOverview=false');await click('Retry loading details');await waitFor('YOUR OPERATIONS, AT A GLANCE');
    const visited=[];
    for(const title of ['Overview','Bookings','Customers','Drivers','Employees','Finance','Support','Settings','Audit','Reports','Content','Enquiries','Promotions','App updates']){
      await evaluate(`document.querySelector('nav[aria-label="Main navigation"] button:nth-child(${visited.length+1})').click()`);await pause(650);
      assert.equal(await evaluate("document.querySelectorAll('[role=alert]').length"),0,title+' has an error');
      assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'),true,title+' overflows');
      const folder=path.join(root,'frontend/admin/screenshots/management');fs.mkdirSync(folder,{recursive:true});const image=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(folder,title.toLowerCase().replaceAll(' ','-')+'.png'),Buffer.from(image.data,'base64'));visited.push(title);console.log('PASS admin fixture page: '+title);
    }

    await evaluate("document.querySelector('select[name=audience]').value='driver'");await type('input[name=version]','1.5.0');await type('input[name=code]','7');await evaluate(`(()=>{const e=document.querySelector('textarea[name=notes]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Fixture release for upload verification');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    const doc=await command('DOM.getDocument');const input=await command('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'input[name=apk]'});await command('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[(()=>{const file=path.join(root,'build/fixture-driver.apk');fs.writeFileSync(file,Buffer.from(JSON.parse(fs.readFileSync(path.join(root,'backend/tests/fixtures/apk-structure.json'),'utf8')).base64,'base64'));return file;})()]});
    await click('Upload APK draft');await waitFor('Upload complete.');assert.equal(await evaluate('window.__releaseFixture.uploaded'),true);await click('Publish verified APK');await waitFor('Published. SHA256:');assert.equal(await evaluate('window.__releaseFixture.items[0].state'),'published');
    console.log('PASS admin APK direct-upload MIME, draft and explicit publish UI with fixture storage');
    assert.ok(await evaluate('window.__apiCalls.includes("/api/v1/actions/admin_driver_payouts")'));
    assert.ok(await evaluate('window.__apiCalls.includes("/api/v1/data/system_settings")'));
    fs.writeFileSync(path.join(root,'build/admin-dashboard-ui.json'),JSON.stringify({kind:'Actual admin components with local fixture API; not hosted staff acceptance',visited,retryAfterFailure:true,exceptions:errors},null,2));
    assert.deepEqual(errors, []);
    console.log(
      "PASS no uncaught browser runtime exceptions. Authenticated local-fixture navigation and failed-dashboard retry passed. Hosted staff acceptance remains pending.",
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
