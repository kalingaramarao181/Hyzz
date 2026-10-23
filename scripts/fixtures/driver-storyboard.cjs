// Local browser-only fixture. This file is never imported by application code.
module.exports=function driverFixture(){
 const original=window.fetch.bind(window),driver='11111111-1111-4111-8111-111111111111',customer='22222222-2222-4222-8222-222222222222';
 const now=()=>new Date().toISOString(),user={id:driver,email:'driver-ui@example.invalid',aud:'authenticated',app_metadata:{},user_metadata:{},created_at:now()};
 const b64=v=>btoa(JSON.stringify(v)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_'),token=b64({alg:'HS256',typ:'JWT'})+'.'+b64({sub:driver,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})+'.'+btoa('local-fixture-signature');
 const booking={id:'33333333-3333-4333-8333-333333333333',reference:'HYZ-UI-FIXTURE',customer_id:customer,driver_id:driver,customer_name:'Rahul Kumar',pickup_address:'KPHB Colony, Hyderabad (UI fixture)',pickup_lat:17.4933,pickup_lng:78.3995,destination_address:'Hitech City, Hyderabad',destination_lat:17.4435,destination_lng:78.3772,scheduled_at:now(),created_at:now(),hours:1,service_type:'hourly',state:'DRIVER_ASSIGNED',estimate_paise:18400,final_paise:null,earnings_paise:16000,commission_paise:2400,payment_status:'pending',driver_cash_confirmed:false,customer_cash_confirmed:false,vehicle:{brand:'Maruti Suzuki',model:'Dzire',registration:'TS 09 AB 1234',color:'White'},history:[]};
 const f=window.__hyzzFixture={online:false,offer:false,accepted:false,booking,prefs:{language:'en',notifications:true,emergency_phone:'+919876543210'},bank:{payee_name:'Vikram Reddy',ifsc:'TEST0123456',last4:'9012'},balance:284000,payouts:[],messages:[],rating:null,tickets:[],calls:[],requestKeys:{},point:{lat:17.471,lng:78.391,updated_at:now(),stale:false}};
 function summary(period){const count=period==='today'?24:period==='week'?7:23;return {trip_earnings_paise:105000,incentives_paise:23400,trips:5,rating:4.8,rating_count:320,bars:Array.from({length:count},(_,i)=>({label:period==='today'?String(i):String(i+1),amount_paise:[0,800,1200,2600,6500,1800,4200][i%7]})),recent:[{...booking,id:'44444444-4444-4444-8444-444444444444',state:'COMPLETED',ended_at:now(),earnings_paise:18400}]};}
 function finances(){return {wallet:{earnings_paise:128400,commission_due_paise:0,cash_collected_paise:151800,available_paise:f.balance,platform_credits_paise:284000},bank:f.bank,payouts:f.payouts,transactions:[{id:'tx1',entry_type:'driver_earnings',amount_paise:18400,created_at:now()},{id:'tx2',entry_type:'incentive',amount_paise:23400,created_at:now()}]};}
 const rows=()=>[{...booking,id:'44444444-4444-4444-8444-444444444444',reference:'HYZ-UI-HISTORY',state:'COMPLETED',final_paise:18400,ended_at:now()},...(f.accepted?[booking]:[])];
 function respond(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});}
 window.fetch=async(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input.url,location.href);if(url.hostname!=='api.srtechcreators.in')return original(input,options);
  const action=url.pathname.split('/').pop();let args={};try{args=JSON.parse(options.body||'{}');}catch{}f.calls.push({path:url.pathname,args});
  if(url.pathname.includes('/releases/latest/'))return respond(f.release||null);
  if(url.pathname.endsWith('/public/content'))return respond([{key:'contact_phone',title:'Support',body:'+917730020465'},{key:'customer_guide',title:'Using Hyzz',body:'Local fixture guide, not hosted content.'}]);
  if(url.pathname.endsWith('/public/contact')){f.enquiries=(f.enquiries||0)+1;return respond({message:'Fixture enquiry received'});}
  if(url.pathname.endsWith('/capabilities'))return respond({google:false,phone:false,push:false,tracking:true});
  if(url.pathname.endsWith('/auth/otp'))return respond({});
  if(url.pathname.endsWith('/auth/verify'))return respond({access_token:token,refresh_token:'local-ui-fixture-refresh',expires_in:3600,token_type:'bearer',user});
  if(url.pathname.endsWith('/auth/user'))return respond(user);
  if(url.pathname.endsWith('/auth/logout'))return new Response(null,{status:204});
  if(url.pathname.includes('/data/')){if(action==='bookings')return respond(rows());if(action==='service_areas')return respond([{id:'zone1',name:'Hitech City',lat:17.4435,lng:78.3772,radius_km:2,enabled:true},{id:'zone2',name:'KPHB',lat:17.4933,lng:78.3995,radius_km:2,enabled:true}]);if(action==='driver_documents')return respond(['driving_license','identity','insurance','police_verification'].map((type,i)=>({id:'doc'+i,document_type:type,status:'approved',expires_on:'2099-12-31',storage_path:driver+'/'+type+'.pdf'})));if(action==='notification_records')return respond([{id:'notice1',title:'Your driver documents are approved.',created_at:now()}]);if(action==='support_tickets')return respond(f.tickets);return respond([]);}
  if(url.pathname.endsWith('/bank/details')){f.bank={payee_name:args.name,ifsc:args.ifsc,last4:args.account.slice(-4)};return respond({saved:true,last4:f.bank.last4});}
  if(url.pathname.endsWith('/maps/route')){
   try{const value=await original('https://router.project-osrm.org/route/v1/driving/'+args.from.lng+','+args.from.lat+';'+args.to.lng+','+args.to.lat+'?overview=full&geometries=geojson',{signal:AbortSignal.timeout(5000)});const result=await value.json(),route=result.routes?.[0];return respond(route?{available:true,coordinates:route.geometry.coordinates,distance_m:route.distance,duration_s:route.duration}:{available:false});}catch{return respond({available:false});}
  }
  if(url.pathname.includes('/actions/')){
   switch(action){
    case 'my_profile':return respond({id:driver,full_name:'Vikram Reddy',phone:'+919876543210',kind:'driver',status:'active',driver:{verification:'approved',online:f.online}});
    case 'driver_summary':return respond(summary(args.p_period));
    case 'driver_finances':return respond(finances());
    case 'driver_preferences':return respond(f.prefs);
    case 'save_driver_preferences':f.prefs={notifications:args.p_notifications,language:args.p_language,emergency_phone:args.p_emergency};return respond(null);
    case 'driver_history':return respond(rows().filter(b=>args.p_filter==='all'||args.p_filter==='completed'&&b.state==='COMPLETED'||args.p_filter==='cancelled'&&b.state.startsWith('CANCELLED')));
    case 'set_availability':f.online=args.p_online;return respond(null);
    case 'driver_requests':return respond(f.offer&&!f.accepted?[{...booking,driver_id:null,customer_name:'Rahul Kumar',estimated_earnings_paise:16000,pickup_km:2.1,request_expires_at:f.expires||new Date(Date.now()+120000).toISOString()}]:[]);
    case 'decline_request':f.offer=false;return respond(null);
    case 'accept_booking':f.accepted=true;f.offer=false;booking.state='DRIVER_ASSIGNED';return respond(booking);
    case 'booking_details':return respond(args.p_booking===booking.id?booking:{...booking,id:args.p_booking,state:'COMPLETED',final_paise:18400,ended_at:now(),driver_cash_confirmed:true,payment_status:'settled'});
    case 'trip_tracking':return respond(['DRIVER_ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','OTP_VERIFIED','IN_PROGRESS'].includes(booking.state)?f.point:null);
    case 'update_trip_location':f.point={lat:args.p_lat,lng:args.p_lng,updated_at:now(),stale:false};return respond(null);
    case 'advance_booking':booking.state=args.p_action==='en_route'?'DRIVER_EN_ROUTE':'DRIVER_ARRIVED';return respond(booking);
    case 'verify_pickup_code':if(args.p_code!=='123456')return respond({ok:false,message:'Wrong fixture code'});booking.state='OTP_VERIFIED';return respond({ok:true});
    case 'start_trip':booking.state='IN_PROGRESS';booking.started_at=now();return respond(booking);
    case 'finish_service_trip':booking.state='COMPLETED';booking.ended_at=now();booking.final_paise=18400;booking.fare={breakdown:{base_paise:15000,service_paise:3400,tax_paise:0}};return respond(booking);
    case 'confirm_cash':booking.driver_cash_confirmed=true;booking.payment_status='driver_confirmed';return respond(null);
    case 'my_trip_rating':return respond(f.rating);
    case 'submit_rating':f.rating={score:args.p_score,review:args.p_review};return respond(null);
    case 'trip_chat':return respond(f.messages);
    case 'send_trip_message':f.messages.push({id:f.messages.length+1,author_id:driver,body:args.p_body,created_at:now()});return respond(f.messages.length);
    case 'request_driver_payout':if(args.p_amount>f.balance)return respond({message:'Amount exceeds available credit'},400);if(!f.requestKeys[args.p_key]){f.requestKeys[args.p_key]=crypto.randomUUID();f.balance-=args.p_amount;f.payouts.unshift({id:f.requestKeys[args.p_key],amount_paise:args.p_amount,state:'pending',last4:f.bank.last4,created_at:now()});}return respond(f.requestKeys[args.p_key]);
    case 'submit_support':f.tickets.unshift({id:crypto.randomUUID(),subject:args.p_subject,status:'open',created_at:now()});return respond(f.tickets[0].id);
    default:return respond(null);
   }
  }
  return respond({});
 };
};
