const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const {webcrypto}=require("node:crypto");
const {TextEncoder}=require("node:util");
const base=path.resolve(__dirname,"..");
function harness({badHash=false,navigate=false,adapterError=false}={}) {
 const bytes=Buffer.from("%PDF-1.4\nfixture");const digest=require("node:crypto").createHash("sha256").update(bytes).digest("hex");
 const calls=[], url="https://job-boards.greenhouse.io/example/jobs/123";
 let listener, gets=0;
 const ctx={crypto:webcrypto,Uint8Array,URL,console,atob:s=>Buffer.from(s,"base64").toString("binary"),btoa:s=>Buffer.from(s,"binary").toString("base64")};
 ctx.chrome={
  tabs:{get:async()=>({url:navigate && ++gets>1?url.replace("123","124"):url})},
  storage:{session:{set:async()=>{}}},
  runtime:{id:"test",getURL:s=>"chrome-extension://test/"+s,onMessage:{addListener:f=>listener=f},
   sendNativeMessage:async(_host,r)=>{calls.push(r.op);
    if(r.op==="prepare")return {ok:true,data:{run:"test",identity:"greenhouse/example/123",filename:"fixture.pdf",
     sha256:badHash?"0".repeat(64):digest,size:bytes.length,chunkSize:262144,fields:[]}};
    if(r.op==="chunk")return {ok:true,data:{offset:0,base64:bytes.toString("base64")}};
    if(r.op==="check")return {ok:true,data:{valid:true}};
    if(r.op==="report")return {ok:true,data:{recorded:true,boardRefreshed:true}};
    throw Error("Unexpected operation");
   }},
  scripting:{executeScript:async r=>{calls.push(r.files?"inject":"fill");
   if(r.files)return [];
   if(adapterError)throw Error("Fixture adapter interrupted");
   return [{result:{status:"verified",fileVerified:true,matched:1,verified:1,pending:0,unknownRequired:0}}];}}
 };
 ctx.importScripts=file=>vm.runInContext(fs.readFileSync(path.join(base,file),"utf8"),context);
 const context=vm.createContext(ctx);
 vm.runInContext(fs.readFileSync(path.join(base,"background.js"),"utf8"),context);
 const run=()=>new Promise(resolve=>listener({op:"prepare",tabId:1},{id:"test",url:"chrome-extension://test/popup.html"},resolve));
 return {calls,run};
}
test("worker: approved bytes -> injection -> readback report; no submit",async()=>{
 const h=harness(),r=await h.run();assert.equal(r.ok,true);
 assert.deepEqual(h.calls,["prepare","chunk","check","inject","fill","report"]);
});
test("worker: bad SHA never reaches page",async()=>{
 const h=harness({badHash:true}),r=await h.run();assert.equal(r.ok,false);assert.ok(!h.calls.includes("inject"));
});
test("worker: navigation never reaches page",async()=>{
 const h=harness({navigate:true}),r=await h.run();assert.equal(r.ok,false);assert.ok(!h.calls.includes("inject"));
});
test("worker: interrupted upload is recorded, never retried",async()=>{
 const h=harness({adapterError:true}),r=await h.run();assert.equal(r.ok,false);
 assert.equal(h.calls.filter(x=>x==="fill").length,1);assert.equal(h.calls.at(-1),"report");
});
