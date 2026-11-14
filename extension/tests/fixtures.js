const sandbox=document.querySelector("#sandbox"),out=document.querySelector("#results");
const URLS={greenhouse:"https://job-boards.greenhouse.io/example/jobs/123",ashby:"https://jobs.ashbyhq.com/example/12345678-1234-1234-1234-123456789abc/application"};
const synthetic=new TextEncoder().encode("%PDF-1.4\nsynthetic local test only\n%%EOF");
let submits=0,fetches=0;
function form(provider,{unknown=false,ambiguous=false,drift=false,hideFilename=false}={}) {
 sandbox.innerHTML=`<form id="fixture"><section id="resume"><label for="resume-file">Resume/CV *</label><input type="file" id="resume-file" accept=".pdf"><div id="filename"></div></section>
 <label for="first">First Name *</label><input id="first" required>
 <label for="mail">Email *</label><input id="mail" type="email" required>
 <label for="start">Start date</label><input id="start" type="date">
 <label for="sponsor">Future sponsorship *</label><select id="sponsor" required><option value="">Choose</option><option value="yes">Yes</option><option value="no">No</option></select>
 <fieldset><legend>Willing to relocate?</legend><label><input type="radio" name="relocate" required>Yes</label><label><input type="radio" name="relocate" required>No</label></fieldset>
 ${provider==="ashby"?'<label for="location">Location *</label><input id="location" role="combobox" aria-controls="options" required><div role="listbox" id="options" hidden><div role="option" tabindex="0">New York</div><div role="option" tabindex="0">Chicago</div></div>':""}
 ${unknown?'<label for="legal">Privacy consent *</label><input id="legal" type="checkbox" required><label for="essay">Why this company? *</label><textarea id="essay" required></textarea>':""}
 ${ambiguous?'<label for="first2">First Name *</label><input id="first2" required>':""}
 <button id="submit" type="submit">Submit Application</button></form>`;
 document.querySelector("#fixture").addEventListener("submit",e=>{e.preventDefault();submits++;});
 document.querySelector("#resume-file").addEventListener("change",e=>{
  document.querySelector("#filename").textContent=hideFilename?"":e.target.files[0]?.name||"";
  // Simulate ATS parsing overwriting inputs after upload.
  setTimeout(()=>{document.querySelector("#first").value="Parser value";},80);
 });
 if(provider==="ashby"){
  const el=document.querySelector("#location"),list=document.querySelector("#options");
  el.addEventListener("click",()=>list.hidden=false);
  list.querySelectorAll("[role=option]").forEach(o=>o.addEventListener("click",()=>{el.value=o.textContent;list.hidden=true;}));
 }
 if(drift)document.querySelector("#mail").addEventListener("change",()=>setTimeout(()=>document.querySelector("#mail").value="changed@example.invalid",180));
}
const fields=[
 {label:"First Name",kind:"text",value:"Synthetic"},
 {label:"Email",kind:"text",value:"test@example.invalid"},
 {label:"Start date",kind:"text",value:"2027-06-01"},
 {label:"Future sponsorship",kind:"select",value:"Yes"},
 {label:"Willing to relocate?",kind:"radio",value:"Yes"}
];
async function payload(provider) {
 return {identity:LedgerCore.identity(URLS[provider]),filename:"synthetic-approved.pdf",sha256:await LedgerCore.sha256(synthetic),
 size:synthetic.length,base64:btoa(String.fromCharCode(...synthetic)),
 fields:provider==="ashby"?[...fields,{label:"Location",kind:"combobox",value:"New York"}]:fields};
}
const assert=(condition,message)=>{if(!condition)throw Error(message);};
document.querySelector("#run").onclick=async()=>{
 document.querySelector("#run").disabled=true;out.textContent="运行中…";submits=0;
 const results=[];
 const test=async(name,fn)=>{try{await fn();results.push("PASS "+name);}catch(e){results.push("FAIL "+name+" — "+e.message);}out.textContent=results.join("\n");};
 await test("Greenhouse: PDF bytes + parser reset + all field kinds",async()=>{
  form("greenhouse");const p=await payload("greenhouse");
  const r=await LedgerPrep.prepare(p,{testURL:URLS.greenhouse});
  assert(r.status==="verified" && r.verified===5,JSON.stringify(r));
  assert(document.querySelector("#first").value==="Synthetic","Parser overwrite not repaired");
 });
 await test("Ashby: bound combobox and field readback",async()=>{
  form("ashby");const r=await LedgerPrep.prepare(await payload("ashby"),{testURL:URLS.ashby});
  assert(r.status==="verified" && r.verified===6,JSON.stringify(r));
 });
 await test("Unknown required and legal consent left untouched",async()=>{
  form("greenhouse",{unknown:true});const r=await LedgerPrep.prepare(await payload("greenhouse"),{testURL:URLS.greenhouse});
  assert(r.status==="needs_attention" && r.unknownRequired>=2,JSON.stringify(r));
  assert(!document.querySelector("#legal").checked && !document.querySelector("#essay").value,"Protected fields changed");
 });
 await test("Duplicate labels fail closed",async()=>{
  form("greenhouse",{ambiguous:true});const r=await LedgerPrep.prepare(await payload("greenhouse"),{testURL:URLS.greenhouse});
  assert(r.pending>=1 && !document.querySelector("#first2").value,JSON.stringify(r));
 });
 await test("Delayed field overwrite detected",async()=>{
  form("greenhouse",{drift:true});const r=await LedgerPrep.prepare(await payload("greenhouse"),{testURL:URLS.greenhouse});
  assert(r.pending>=1 && r.status==="needs_attention",JSON.stringify(r));
 });
 await test("Input bytes alone do not prove upload UI acceptance",async()=>{
  form("greenhouse",{hideFilename:true});const r=await LedgerPrep.prepare(await payload("greenhouse"),{testURL:URLS.greenhouse});
  assert(r.fileVerified && r.status==="needs_attention",JSON.stringify(r));
 });
 await test("Wrong job rejected before any file assignment",async()=>{
  form("greenhouse");const p=await payload("greenhouse");p.identity="greenhouse/other/123";
  let failed=false;try{await LedgerPrep.prepare(p,{testURL:URLS.greenhouse});}catch{failed=true;}
  assert(failed && !document.querySelector("#resume-file").files.length,"Wrong job accepted");
 });
 await test("Changed PDF rejected before upload",async()=>{
  form("greenhouse");const p=await payload("greenhouse");p.sha256="0".repeat(64);
  let failed=false;try{await LedgerPrep.prepare(p,{testURL:URLS.greenhouse});}catch{failed=true;}
  assert(failed && !document.querySelector("#resume-file").files.length,"Changed PDF accepted");
 });
 await test("Existing attachment never overwritten silently",async()=>{
  form("greenhouse");const dt=new DataTransfer();dt.items.add(new File(["existing"],"existing.pdf"));document.querySelector("#resume-file").files=dt.files;
  let failed=false;try{await LedgerPrep.prepare(await payload("greenhouse"),{testURL:URLS.greenhouse});}catch{failed=true;}
  assert(failed && document.querySelector("#resume-file").files[0].name==="existing.pdf","Attachment overwritten");
 });
 await test("Zero submit events",async()=>assert(submits===0,"Submission happened"));
 const failures=results.filter(s=>s.startsWith("FAIL"));
 out.textContent=results.join("\n")+"\n\n"+(failures.length?"FAILED "+failures.length:"ALL "+results.length+" PASSED")+" · submit events: "+submits;
 document.querySelector("#run").disabled=false;
};
