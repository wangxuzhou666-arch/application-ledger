const sandbox=document.querySelector("#sandbox"),out=document.querySelector("#results");
const URLS={greenhouse:"https://job-boards.greenhouse.io/example/jobs/123",ashby:"https://jobs.ashbyhq.com/example/12345678-1234-1234-1234-123456789abc/application"};
const synthetic=new TextEncoder().encode("%PDF-1.4\nsynthetic local test only\n%%EOF");
let submits=0,roots=[];
// Capture on window runs before the adapter's document-level guard, so attempts are still counted.
window.addEventListener("submit",e=>{e.preventDefault();submits++;},true);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check,message,ms=20000) {
 for(const start=Date.now();!check();await wait(50))if(Date.now()-start>ms)throw Error(message);
}
function form(provider,{unknown=false,ambiguous=false,drift=false,hideFilename=false,afterUpload="",attached="",extra=""}={}) {
 roots.forEach(r=>r.unmount());roots=[];
 sandbox.innerHTML=`<form id="fixture"><section id="resume"><label for="resume-file">Resume/CV *</label><input type="file" id="resume-file" accept=".pdf"><div id="filename">${attached}</div></section>
 <label for="first">First Name *</label><input id="first" required>
 <label for="mail">Email *</label><input id="mail" type="email" required>
 <label for="start">Start date</label><input id="start" type="date">
 <label for="sponsor">Future sponsorship *</label><select id="sponsor" required><option value="">Choose</option><option value="yes">Yes</option><option value="no">No</option></select>
 <fieldset><legend>Willing to relocate?</legend><label><input type="radio" name="relocate" required>Yes</label><label><input type="radio" name="relocate" required>No</label></fieldset>
 ${provider==="ashby"?'<label for="location">Location *</label><input id="location" role="combobox" aria-controls="options" required><div role="listbox" id="options" hidden><div role="option" tabindex="0">New York</div><div role="option" tabindex="0">Chicago</div></div>':""}
 ${unknown?'<label for="legal">Privacy consent *</label><input id="legal" type="checkbox" required><label for="essay">Why this company? *</label><textarea id="essay" required></textarea>':""}
 ${ambiguous?'<label for="first2">First Name *</label><input id="first2" required>':""}
 ${extra}
 <button id="submit" type="submit">Submit Application</button></form>`;
 document.querySelector("#resume-file").addEventListener("change",e=>{
  document.querySelector("#filename").textContent=hideFilename?"":e.target.files[0]?.name||"";
  // Simulate ATS parsing overwriting inputs after upload.
  setTimeout(()=>{document.querySelector("#first").value="Parser value";},80);
  // Real ATS behaviour after upload is unverified: cover keeping, clearing and replacing the input.
  if(afterUpload==="clear")setTimeout(()=>{e.target.value="";},40);
  // A fresh element: Chrome's cloneNode() would copy the selected FileList.
  if(afterUpload==="replace")setTimeout(()=>e.target.replaceWith(Object.assign(document.createElement("input"),{type:"file",id:"resume-file",accept:".pdf"})),40);
 });
 if(provider==="ashby"){
  const el=document.querySelector("#location"),list=document.querySelector("#options");
  el.addEventListener("click",()=>list.hidden=false);
  list.querySelectorAll("[role=option]").forEach(o=>o.addEventListener("click",()=>{el.value=o.textContent;list.hidden=true;}));
 }
 if(drift)document.querySelector("#mail").addEventListener("change",()=>setTimeout(()=>document.querySelector("#mail").value="changed@example.invalid",180));
}
async function reactSelect(spec) {
 await until(()=>globalThis.ReactSelectFixture,"react-select CDN fixture did not load");
 const host=document.createElement("div");
 document.querySelector("#fixture").insertBefore(host,document.querySelector("#submit"));
 roots.push(ReactSelectFixture.mount(host,spec));
 return document.getElementById(spec.id);
}
// Ashby-style questions: label class marks required, Yes/No are default-type buttons outside any <form>.
function ashbyForm({inForm=false}={}) {
 roots.forEach(r=>r.unmount());roots=[];
 const entry=(title,body,required=true)=>`<div class="_fieldEntry_x ashby-application-form-field-entry"><label class="_heading_x ${required?"_required_x":""} ashby-application-form-question-title">${title}</label>${body}</div>`;
 const yesno='<div class="_container_y _yesno_y"><button class="_option_y" aria-pressed="false">Yes</button><button class="_option_y" aria-pressed="false">No</button></div><input type="checkbox" hidden>';
 const body=entry("Resume",'<div><input type="file" id="_systemfield_resume"><div class="shown"></div></div>').replace("<label","<label for=\"_systemfield_resume\"")+
  entry("Name",'<input id="_systemfield_name" required>').replace("<label","<label for=\"_systemfield_name\"")+
  entry("Can you work onsite?",yesno)+entry("Is your graduation date in 2027?",yesno)+
  entry("Pick an interview slot",'<div class="custom-slot-picker" tabindex="0">Choose</div>')+
  '<button id="submit">Submit Application</button>';
 sandbox.innerHTML=inForm?`<form id="fixture">${body}</form>`:`<div id="form">${body}</div>`;
 sandbox.querySelectorAll("._yesno_y").forEach(group=>group.querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{
  group.querySelectorAll("button").forEach(x=>{x.setAttribute("aria-pressed",String(x===b));x.classList.toggle("_active_y",x===b);});
 })));
 document.querySelector("#_systemfield_resume").addEventListener("change",e=>{document.querySelector(".shown").textContent=e.target.files[0]?.name||"";});
}
const fields=[
 {label:"First Name",kind:"text",value:"Synthetic"},
 {label:"Email",kind:"text",value:"test@example.invalid"},
 {label:"Start date",kind:"text",value:"2027-06-01"},
 {label:"Future sponsorship",kind:"select",value:"Yes"},
 {label:"Willing to relocate?",kind:"radio",value:"Yes"}
];
async function payload(provider,extraFields) {
 return {identity:LedgerCore.identity(URLS[provider]),filename:"synthetic-approved.pdf",sha256:await LedgerCore.sha256(synthetic),
 size:synthetic.length,base64:btoa(String.fromCharCode(...synthetic)),
 fields:extraFields||(provider==="ashby"?[...fields,{label:"Location",kind:"combobox",value:"New York"}]:fields)};
}
const assert=(condition,message)=>{if(!condition)throw Error(message);};
const expanded=()=>[...document.querySelectorAll("[role=combobox]")].filter(el=>el.getAttribute("aria-expanded")==="true").length;
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
  assert(r.status==="needs_attention" && r.unansweredRequired>=2 && r.reasons.includes("unknown_required"),JSON.stringify(r));
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
  assert(r.fileVerified && r.status==="needs_attention" && r.reasons.includes("file_not_shown"),JSON.stringify(r));
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
 // v0.2 scenarios
 await test("react-select (Greenhouse wrapper and plain): open, choose, read shown value",async()=>{
  form("greenhouse");
  const a=await reactSelect({id:"q-relocate",label:"Open to relocation?",options:["Yes","No"]});
  const b=await reactSelect({id:"q-team",label:"Preferred team",options:["Platform","Data"],controlled:false});
  const r=await LedgerPrep.prepare(await payload("greenhouse",[...fields,{label:"Open to relocation?",kind:"combobox",value:"Yes"},{label:"Preferred team",kind:"combobox",value:"Data"}]),{testURL:URLS.greenhouse});
  assert(r.status==="verified" && r.verified===7 && r.reasons.length===0,JSON.stringify(r));
  assert(a.value==="" && b.value==="" && expanded()===0,"Menu left open or input not cleared");
  assert(document.querySelectorAll("[class*=single-value]").length===2,"Choices not shown");
 });
 await test("react-select missing option: abandoned and menu closed",async()=>{
  form("greenhouse");await reactSelect({id:"q-relocate",label:"Open to relocation?",options:["Yes","No"]});
  const r=await LedgerPrep.prepare(await payload("greenhouse",[...fields,{label:"Open to relocation?",kind:"combobox",value:"Maybe"}]),{testURL:URLS.greenhouse});
  assert(r.status==="needs_attention" && r.pending===1 && r.reasons.includes("option_not_found"),JSON.stringify(r));
  assert(expanded()===0 && !document.querySelector("[class*=single-value]"),"Menu left open or value chosen");
 });
 await test("react-select duplicate options fail closed",async()=>{
  form("greenhouse");await reactSelect({id:"q-relocate",label:"Open to relocation?",options:["Yes","Yes","No"]});
  const r=await LedgerPrep.prepare(await payload("greenhouse",[...fields,{label:"Open to relocation?",kind:"combobox",value:"Yes"}]),{testURL:URLS.greenhouse});
  assert(r.status==="needs_attention" && r.reasons.includes("option_not_found"),JSON.stringify(r));
  assert(expanded()===0 && !document.querySelector("[class*=single-value]"),"Menu left open or value chosen");
 });
 await test("Already open react-select menu is used as is, never typed into",async()=>{
  form("greenhouse");const el=await reactSelect({id:"q-relocate",label:"Open to relocation?",options:["Yes","No"]});
  let typed=0;el.addEventListener("input",()=>typed++);
  for(const type of ["keydown","keyup"])el.dispatchEvent(new KeyboardEvent(type,{key:"ArrowDown",code:"ArrowDown",bubbles:true}));
  await until(()=>el.getAttribute("aria-expanded")==="true","Fixture menu did not open",2000);
  const r=await LedgerPrep.prepare(await payload("greenhouse",[...fields,{label:"Open to relocation?",kind:"combobox",value:"Maybe"}]),{testURL:URLS.greenhouse});
  assert(typed===0 && r.reasons.includes("option_not_found") && expanded()===0,"typed "+typed+" "+JSON.stringify(r));
 });
 await test("Unfilled required react-select counts once as unanswered",async()=>{
  form("greenhouse");await reactSelect({id:"q-degree",label:"Degree",options:["BS","MS"]});
  const r=await LedgerPrep.prepare(await payload("greenhouse"),{testURL:URLS.greenhouse});
  assert(r.unansweredRequired===1 && r.reasons.includes("unknown_required") && r.status==="needs_attention",JSON.stringify(r));
 });
 await test("reCAPTCHA badge is not a challenge",async()=>{
  // Two independent exclusions: the badge container, and an invisible-size widget outside it.
  form("greenhouse",{extra:'<div class="grecaptcha-badge" style="position:fixed;bottom:14px;right:0;width:256px;height:60px"><iframe title="reCAPTCHA" src="about:blank#recaptcha/enterprise/anchor?ar=1" width="256" height="60"></iframe></div>'+
   '<iframe title="reCAPTCHA" src="about:blank#recaptcha/api2/anchor?ar=1&size=invisible" width="256" height="60"></iframe>'});
  const r=await LedgerPrep.prepare(await payload("greenhouse"),{testURL:URLS.greenhouse});
  assert(r.status==="verified" && !r.reasons.includes("captcha_challenge"),JSON.stringify(r));
 });
 await test("Visible captcha challenge needs the applicant",async()=>{
  form("greenhouse",{extra:'<div><iframe title="recaptcha challenge" src="about:blank#recaptcha/api2/bframe" width="300" height="300"></iframe></div>'});
  const r=await LedgerPrep.prepare(await payload("greenhouse"),{testURL:URLS.greenhouse});
  assert(r.status==="needs_attention" && r.reasons.includes("captcha_challenge"),JSON.stringify(r));
 });
 await test("Ashby Yes/No: formless button answered, unanswered required counted",async()=>{
  ashbyForm();
  const r=await LedgerPrep.prepare(await payload("ashby",[{label:"Name",kind:"text",value:"Synthetic"},{label:"Can you work onsite?",kind:"yesno",value:"No"}]),{testURL:URLS.ashby});
  const [onsite,grad]=[...document.querySelectorAll("._yesno_y")].map(g=>[...g.querySelectorAll("button")].map(b=>b.getAttribute("aria-pressed")).join());
  // Unanswered: the graduation Yes/No and the unsupported required slot picker.
  assert(r.verified===2 && r.pending===0 && r.fileVerified && r.unansweredRequired===2,JSON.stringify(r));
  assert(r.reasons.includes("unanswered_buttons") && r.reasons.includes("unknown_required") && r.status==="needs_attention",JSON.stringify(r));
  assert(onsite==="false,true" && grad==="false,false","Wrong Yes/No state "+onsite+" / "+grad);
 });
 await test("Yes/No buttons owned by a <form> are never clicked",async()=>{
  ashbyForm({inForm:true});
  const r=await LedgerPrep.prepare(await payload("ashby",[{label:"Can you work onsite?",kind:"yesno",value:"Yes"}]),{testURL:URLS.ashby});
  assert(r.pending===1 && r.reasons.includes("field_readback_failed"),JSON.stringify(r));
  assert(![...document.querySelectorAll("._yesno_y button")].some(b=>b.getAttribute("aria-pressed")==="true"),"Form-owned button clicked");
 });
 await test("Upload then input cleared: verified by shown filename (file_input_reset)",async()=>{
  form("greenhouse",{afterUpload:"clear"});const r=await LedgerPrep.prepare(await payload("greenhouse"),{testURL:URLS.greenhouse});
  assert(!document.querySelector("#resume-file").files.length,"Fixture did not clear the input");
  assert(r.fileVerified && r.status==="verified" && r.reasons.join()==="file_input_reset",JSON.stringify(r));
 });
 await test("Upload then input replaced: verified by shown filename (file_input_reset)",async()=>{
  form("greenhouse",{afterUpload:"replace"});const original=document.querySelector("#resume-file");
  const r=await LedgerPrep.prepare(await payload("greenhouse"),{testURL:URLS.greenhouse});
  assert(!original.isConnected && !document.querySelector("#resume-file").files.length,"Fixture did not replace the input");
  assert(r.fileVerified && r.status==="verified" && r.reasons.join()==="file_input_reset",JSON.stringify(r));
 });
 await test("Input cleared and filename not shown: file_not_shown",async()=>{
  form("greenhouse",{afterUpload:"clear",hideFilename:true});const r=await LedgerPrep.prepare(await payload("greenhouse"),{testURL:URLS.greenhouse});
  assert(!r.fileVerified && r.status==="needs_attention" && r.reasons.includes("file_not_shown"),JSON.stringify(r));
 });
 await test("Attachment shown beside an empty input is not replaced",async()=>{
  for(const attached of ["existing-resume.pdf",'<button type="button" aria-label="Remove file">×</button>']) {
   form("greenhouse",{attached});
   let failed=false;try{await LedgerPrep.prepare(await payload("greenhouse"),{testURL:URLS.greenhouse});}catch{failed=true;}
   assert(failed && !document.querySelector("#resume-file").files.length,"Replaced an attachment shown as "+attached);
  }
 });
 await test("Scan lists questions without values; searched combobox never opened",async()=>{
  form("greenhouse",{extra:'<label for="gender">Gender</label><select id="gender"><option value="">Choose</option><option value="a">Option A</option></select>'});
  await reactSelect({id:"q-relocate",label:"Open to relocation?",options:["Yes","No"]});
  const city=await reactSelect({id:"q-city",label:"Location (City)",options:["Anywhere"]});
  let cityKeys=0;city.addEventListener("keydown",()=>cityKeys++);city.addEventListener("keyup",()=>cityKeys++);
  document.querySelector("#first").value="Zed Unique-Value";document.querySelector("#sponsor").value="no";
  const s=await LedgerPrep.scan();const by=Object.fromEntries(s.questions.map(q=>[q.label,q]));
  assert(!JSON.stringify(s).includes("Zed Unique-Value"),"Scan leaked a field value");
  assert(by["Resume/CV"].kind==="file" && by["First Name"].kind==="text" && by["First Name"].required,"Basic kinds");
  assert(by["Future sponsorship"].kind==="select" && by["Future sponsorship"].options.join()==="Yes,No","Select options");
  assert(by["Willing to relocate?"].kind==="radio" && by["Willing to relocate?"].options.join()==="Yes,No" && by["Willing to relocate?"].required,"Radio group");
  assert(by["Open to relocation?"].kind==="combobox" && by["Open to relocation?"].options.join()==="Yes,No" && by["Open to relocation?"].required,"Combobox options "+JSON.stringify(by["Open to relocation?"]));
  assert(by["Location (City)"].options===null && cityKeys===0,"Searched combobox was opened");
  assert(by.Gender.protected && !by["First Name"].protected,"Protected flag");
  assert(expanded()===0 && !document.querySelector("[class*=single-value]"),"Scan left a menu open or chose a value");
  assert(s.questions.every(q=>Object.keys(q).join()==="label,kind,required,protected,options,optionsTruncated"),"Unexpected scan keys");
 });
 await test("Scan Ashby blocks: Yes/No, class-marked required, unsupported widget",async()=>{
  ashbyForm();const s=await LedgerPrep.scan();const by=Object.fromEntries(s.questions.map(q=>[q.label,q]));
  assert(by["Can you work onsite?"].kind==="yesno" && by["Can you work onsite?"].required && by["Can you work onsite?"].options.join()==="Yes,No","Yes/No question");
  assert(by.Resume.kind==="file" && by.Resume.required && by.Name.required,"Required from label class");
  assert(by["Pick an interview slot"].kind==="unsupported" && by["Pick an interview slot"].required,"Unsupported widget");
  assert(s.questions.length===5,"Hidden Yes/No checkboxes listed separately: "+s.questions.map(q=>q.kind).join());
 });
 await test("Zero submit events",async()=>assert(submits===0,"Submission happened"));
 roots.forEach(r=>r.unmount());roots=[];
 const failures=results.filter(s=>s.startsWith("FAIL"));
 out.textContent=results.join("\n")+"\n\n"+(failures.length?"FAILED "+failures.length:"ALL "+results.length+" PASSED")+" · submit events: "+submits;
 document.querySelector("#run").disabled=false;
};
