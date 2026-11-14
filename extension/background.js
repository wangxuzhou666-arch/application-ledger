importScripts("core.js");
const HOST="org.application_ledger.prepare";
const running=new Set();
const native=async request=>{
 const response=await chrome.runtime.sendNativeMessage(HOST,request);
 if(!response?.ok)throw Error(response?.error||"Native bridge unavailable");
 return response.data;
};
async function execute(tabId) {
 if(running.has(tabId))throw Error("Already preparing this tab");
 running.add(tabId);
 let meta, report, url;
 try {
  const tab=await chrome.tabs.get(tabId); url=tab.url;
  const expected=LedgerCore.identity(url);
  meta=await native({op:"prepare",url});
  if(meta.identity!==expected)throw Error("Packet does not belong to this page");
  let base64="",binary="";
  for(let offset=0;offset<meta.size;offset+=meta.chunkSize) {
   const chunk=await native({op:"chunk",run:meta.run,url,offset});
   if(chunk.offset!==offset)throw Error("Chunk order mismatch");
   binary+=atob(chunk.base64);
  }
  const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
  if(bytes.length!==meta.size || await LedgerCore.sha256(bytes)!==meta.sha256)throw Error("Extension SHA256 mismatch");
  base64=btoa(binary);binary="";
  if(LedgerCore.identity((await chrome.tabs.get(tabId)).url)!==expected)throw Error("Tab navigated");
  await native({op:"check",url,run:meta.run});
  await chrome.scripting.executeScript({target:{tabId},files:["core.js","content.js"]});
  const results=await chrome.scripting.executeScript({
   target:{tabId},func:async payload=>await globalThis.LedgerPrep.prepare(payload),args:[{...meta,base64}]
  });
  report=results[0]?.result;
  if(!report)throw Error("No page readback returned");
  if(LedgerCore.identity((await chrome.tabs.get(tabId)).url)!==expected)throw Error("Tab navigated during verification");
  const saved=await native({op:"report",url,run:meta.run,report});
  // Persist only counts and fixed reason codes. No answers, filenames, PDF bytes or labels in extension storage.
  const summary={identity:expected,at:new Date().toISOString(),...Object.fromEntries(["status","fileVerified","matched","verified","pending","unansweredRequired","reasons"].map(k=>[k,report[k]])),...saved};
  await chrome.storage.session.set({["tab"+tabId]:summary});
  return summary;
 } catch(e) {
  // Do not retry upload on failure; the webpage may already have accepted it.
  const message=e.message||"Preparation failed";
  if(meta && !report) {
   try {await native({op:"report",url,run:meta.run,report:{status:"failed",fileVerified:false,matched:0,verified:0,pending:0,unansweredRequired:0,reasons:[]}});}
   catch { /* Approval may have been revoked; never retry an upload to recover bookkeeping. */ }
  }
  await chrome.storage.session.set({["tab"+tabId]:{identity:meta?.identity,at:new Date().toISOString(),error:message,submission:"not_attempted"}});
  throw e;
 } finally {running.delete(tabId);}
}
// Read-only: lists the questions on the page for answer drafting. No PDF, no filling, no run.
async function scan(tabId) {
 if(running.has(tabId))throw Error("Already working on this tab");
 running.add(tabId);
 try {
  const url=(await chrome.tabs.get(tabId)).url, expected=LedgerCore.identity(url);
  await chrome.scripting.executeScript({target:{tabId},files:["core.js","content.js"]});
  const results=await chrome.scripting.executeScript({target:{tabId},func:async()=>await globalThis.LedgerPrep.scan()});
  const found=results[0]?.result;
  if(!found)throw Error("No page scan returned");
  if(LedgerCore.identity((await chrome.tabs.get(tabId)).url)!==expected)throw Error("Tab navigated during scan");
  return await native({op:"scan",url,scan:found});
 } finally {running.delete(tabId);}
}
chrome.runtime.onMessage.addListener((request,sender,sendResponse)=>{
 if(sender.id!==chrome.runtime.id || sender.url!==chrome.runtime.getURL("popup.html"))return false;
 const task=request.op==="prepare"?execute:request.op==="scan"?scan:null;
 if(!task || !Number.isInteger(request.tabId))return false;
 task(request.tabId).then(data=>sendResponse({ok:true,data}),e=>sendResponse({ok:false,error:e.message}));
 return true;
});
