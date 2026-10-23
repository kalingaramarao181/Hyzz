const {spawn}=require('child_process'),http=require('http'),fs=require('fs'),path=require('path'),assert=require('assert/strict'),WebSocket=require('ws');
const root=path.resolve(__dirname,'..'),pause=ms=>new Promise(r=>setTimeout(r,ms));let browser,ws,next=0;const pending=new Map(),servers=[],errors=[];
function serve(audience,port){const folder=path.join(root,'frontend',audience,'web-preview');const server=http.createServer((req,res)=>{try{const p=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const file=path.resolve(folder,'.'+(p==='/'?'/index.html':p));if(!file.startsWith(folder+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);return res.end();}const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.ttf':'font/ttf','.json':'application/json'}[path.extname(file)]||'application/octet-stream';res.setHeader('Content-Type',mime);fs.createReadStream(file).pipe(res);}catch{res.writeHead(400);res.end();}});server.listen(port,'127.0.0.1');servers.push(server);}
function command(method,params={}){const id=++next;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(pending.has(id)){pending.delete(id);reject(new Error('CDP timeout '+method));}},20000).unref();});}
async function evaluate(expression){const data=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(data.exceptionDetails)throw new Error(data.exceptionDetails.exception?.description||data.exceptionDetails.text);return data.result.value;}
function fixtureNetwork(){
 const original=window.fetch.bind(window),driver=location.port==='4175',id=driver?'22222222-2222-4222-8222-222222222222':'11111111-1111-4111-8111-111111111111';
 const user={id,email:'ui-fixture@example.invalid',aud:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()};
 const b64=value=>btoa(JSON.stringify(value)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
 const token=b64({alg:'HS256',typ:'JWT'})+'.'+b64({sub:id,exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000),role:'authenticated'})+'.'+btoa('fixture-signature');
 const booking={id:'33333333-3333-4333-8333-333333333333',reference:'HYZ-UI-FIXTURE',pickup_address:'KPHB Colony, Hyderabad (UI fixture)',pickup_lat:17.4933,pickup_lng:78.3995,destination_address:'Hitech City (UI fixture)',destination_lat:17.4435,destination_lng:78.3772,state:'IN_PROGRESS',service_type:'hourly',hours:1,estimate_paise:29500,scheduled_at:new Date().toISOString(),started_at:new Date(Date.now()-600000).toISOString(),driver_name:'Demo Driver',customer_name:'Demo Customer',driver_rating:4.8,history:[]};
 window.fetch=async(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input.url,location.href);if(url.hostname!=='api.srtechcreators.in')return original(input,options);
  let result={};const action=url.pathname.split('/').pop();
  if(url.pathname.endsWith('/capabilities'))result={google:false,phone:false,push:false,tracking:true};
  else if(url.pathname.endsWith('/auth/verify'))result={access_token:token,refresh_token:'local-ui-fixture-refresh-token',expires_in:3600,token_type:'bearer',user};
  else if(url.pathname.endsWith('/auth/user'))result=user;
  else if(url.pathname.includes('/actions/')){
   if(action==='my_profile')result={id,full_name:driver?'Demo Driver':'Demo Customer',kind:driver?'driver':'customer',status:'active',driver:driver?{verification:'approved',online:false}:null};
   else if(action==='booking_details')result=booking;
   else if(action==='trip_tracking')result={lat:17.471,lng:78.391,updated_at:new Date().toISOString(),stale:false};
   else if(action==='driver_wallet')result={earnings_paise:128400,commission_due_paise:23400,cash_collected_paise:151800};
   else if(['my_vehicles','my_places','nearby_requests'].includes(action))result=[];
   else result=null;
  }else if(url.pathname.includes('/data/'))result=action==='bookings'?[booking]:[];
  else if(url.pathname.endsWith('/maps/route'))result={available:false};
  return new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json'}});
 };
}

(async()=>{try{serve('customer',4174);serve('driver',4175);browser=spawn(process.env.CHROME_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=9336',`--user-data-dir=${path.join(root,'.browser-fixture-check')}`,'about:blank'],{windowsHide:true,stdio:'ignore'});let targets;for(let i=0;i<60;i++){try{targets=await(await fetch('http://127.0.0.1:9336/json/list')).json();break;}catch{}await pause(250);}ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});ws.on('message',raw=>{const m=JSON.parse(raw);if(m.id){const item=pending.get(m.id);if(item){pending.delete(m.id);m.error?item.reject(new Error(m.error.message)):item.resolve(m.result);}}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);});await command('Page.enable');await command('Runtime.enable');await command('Emulation.setDeviceMetricsOverride',{width:412,height:915,deviceScaleFactor:1,mobile:true});await command('Page.addScriptToEvaluateOnNewDocument',{source:'('+fixtureNetwork.toString()+')()'});
for(const [audience,port]of [['customer',4174]]){
 await command('Page.navigate',{url:`http://127.0.0.1:${port}`});
 async function waitFor(text){for(let i=0;i<100;i++){if((await evaluate('document.body.innerText')).includes(text))return;if(errors.length)throw new Error(errors.join('\n'));await pause(250);}throw new Error('UI did not show '+text+': '+await evaluate('document.body.innerText'));}
 await waitFor('Welcome to Hyzz');await evaluate("document.querySelector('input[aria-label=\"Email address\"]').focus()");await command('Input.insertText',{text:'ui-fixture@example.invalid'});
 await evaluate("document.querySelector('[aria-label=\"Send verification code\"]').click()");await waitFor('Verification code');
 await evaluate("document.querySelector('input[aria-label=\"Verification code\"]').focus()");await command('Input.insertText',{text:'123456'});await evaluate("document.querySelector('[aria-label=\"Verify & continue\"]').click()");
 await waitFor(audience==='customer'?'Where will today take you?':'Your availability');await pause(1500);
 const output=path.join(root,'frontend',audience,'screenshots');
 async function capture(name){assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);const r=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(output,'fixture-'+name+'.png'),Buffer.from(r.data,'base64'));}
 await capture('home');
 await evaluate("Array.from(document.querySelectorAll('[role=button]')).find(e=>e.innerText.includes('"+(audience==='customer'?'Your current booking':'HYZ-UI-FIXTURE')+"')).click()");await waitFor('Running time:');await pause(2000);await capture('live-trip');
 await evaluate("document.querySelector('[aria-label=\"Account\"]').click()");await waitFor('Your profile');await capture('account');
 console.log('PASS '+audience+' local-fixture email UI ? home ? active trip map ? account; screenshots saved. No hosted login or trip was created.');
}
assert.deepEqual(errors,[]);console.log('Screenshots render real React Native Web components with explicitly mocked local fixture API responses. They do not prove live GPS or provider delivery.');
}catch(e){console.error(e.message);process.exitCode=1;}finally{if(ws?.readyState===WebSocket.OPEN)await command('Browser.close').catch(()=>{});ws?.close();browser?.kill();for(const server of servers)server.close();}})();

// Driver storyboard journeys use driver-storyboard-check.cjs.
