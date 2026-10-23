// Generate HTTP validation contracts from implemented public SQL signatures.
const fs=require('fs');
const directory='backend/database/migrations';
const sql=fs.readdirSync(directory).sort().map(file=>fs.readFileSync(directory+'/'+file,'utf8')).join('\n');
const contracts={};
for(const match of sql.matchAll(/create (?:or replace )?function public\.(\w+)\(([^)]*)\) returns (\w+)/gi)){
 const [,name,args]=match;if(name==='admin_provision_user'||name.startsWith('api_'))continue;
 const properties={},required=[];
 for(const argument of args.split(',').map(v=>v.trim()).filter(Boolean)){
  const [key,type]=argument.split(/\s+/);let schema;
  if(type==='uuid')schema={type:'string',format:'uuid'};
  else if(type==='date'||type==='timestamptz')schema={type:'string',format:type==='date'?'date':'date-time'};
  else if(type==='integer'||type==='bigint')schema={type:'integer',format:type==='bigint'?'int64':'int32'};
  else if(type==='double')schema={type:'number',format:'double'};
  else if(type==='boolean')schema={type:'boolean'};
  else if(type==='text[]')schema={type:'array',items:{type:'string'}};
  else schema={type:'string'};
  if(/default null/i.test(argument))schema={anyOf:[schema,{type:'null'}]};
  if(!/\bdefault\b/i.test(argument))required.push(key);
  properties[key]=schema;
 }
 contracts[name]={type:'object',properties,required,additionalProperties:false};
}
fs.writeFileSync('backend/src/modules/action-contracts.json',JSON.stringify(contracts,null,2)+'\n');
console.log(`Generated ${Object.keys(contracts).length} contracts from SQL. Review any new function before exposing it; internal provisioning remains excluded.`);
