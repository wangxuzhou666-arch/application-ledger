/* This module never clicks submit/next, presses Enter, or calls form.submit().
   Assignment to a file input may immediately upload to the ATS: run only after approval.
*/
(() => {
 const {norm,identity,protectedLabel,sha256}=globalThis.LedgerCore;
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const visible=el=>!el.disabled && !el.closest("[inert]") && el.getClientRects().length>0 &&
   getComputedStyle(el).visibility!=="hidden";
 function label(el) {
   const aria=el.getAttribute("aria-label"); if(aria)return norm(aria);
   const ids=el.getAttribute("aria-labelledby");
   if(ids)return norm(ids.split(/\s+/).map(id=>document.getElementById(id)?.textContent||"").join(" "));
   if(el.labels?.length)return norm([...el.labels].map(x=>x.textContent).join(" "));
   if(el.type==="radio") {
     const group=el.closest("fieldset,[role=radiogroup]");
     return group ? norm(group.querySelector("legend")?.textContent || group.getAttribute("aria-label")) : "";
   }
   return "";
 }
 function groupLabel(el) {
   const group=el.closest("fieldset,[role=radiogroup]");
   if(!group)return "";
   return norm(group.querySelector("legend")?.textContent || group.getAttribute("aria-label") ||
     (group.getAttribute("aria-labelledby")||"").split(/\s+/).map(id=>document.getElementById(id)?.textContent||"").join(" "));
 }
 function controls(){return [...document.querySelectorAll("input,textarea,select,[role=combobox]")].filter(visible);}
 function resolve(field) {
   if(protectedLabel(field.label))throw Error("protected");
   if(field.kind==="radio") {
     const radios=controls().filter(el=>el.type==="radio" && groupLabel(el)===norm(field.label));
     const groups=new Set(radios.map(el=>el.closest("fieldset,[role=radiogroup]")));
     const chosen=radios.filter(el=>label(el)===norm(field.value));
     if(groups.size!==1 || chosen.length!==1)throw Error("ambiguous_radio");
     return chosen[0];
   }
   const hits=controls().filter(el=>el.type!=="radio" && label(el)===norm(field.label));
   if(hits.length!==1)throw Error("missing_or_ambiguous");
   return hits[0];
 }
 function actual(el,field) {
   if(field.kind==="select")return norm(el.selectedOptions?.[0]?.textContent);
   if(field.kind==="radio")return el.checked ? norm(label(el)) : "";
   if(field.kind==="combobox")return norm(el.value || el.textContent);
   return el.value;
 }
 function setText(el,value) {
   if(!["INPUT","TEXTAREA"].includes(el.tagName) || ["file","hidden","checkbox","radio","button","submit","password"].includes(el.type) || el.readOnly)
     throw Error("unsupported_text");
   const proto=el.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
   Object.getOwnPropertyDescriptor(proto,"value").set.call(el,value);
   el.dispatchEvent(new Event("input",{bubbles:true}));
   el.dispatchEvent(new Event("change",{bubbles:true}));
   el.dispatchEvent(new Event("blur",{bubbles:true}));
 }
 async function fill(field,assertPage) {
   assertPage();
   let el=resolve(field);
   if(field.kind==="text")setText(el,field.value);
   else if(field.kind==="select") {
     if(el.tagName!=="SELECT")throw Error("not_native_select");
     const options=[...el.options].filter(o=>norm(o.textContent)===norm(field.value) && !o.disabled);
     if(options.length!==1)throw Error("option_missing_or_ambiguous");
     Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(el,options[0].value);
     el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));
   } else if(field.kind==="radio")el.click();
   else if(field.kind==="combobox") {
     if(el.getAttribute("role")!=="combobox")throw Error("not_combobox");
     // Never click generic buttons or attempt free-form keyboard navigation.
     if(el.tagName==="BUTTON" && el.type!=="button")throw Error("unsafe_button");
     el.click();
     if(el.tagName==="INPUT" && !el.readOnly)setText(el,field.value);
     let opts=[];
     for(let i=0;i<12;i++) {
       assertPage();
       const ids=(el.getAttribute("aria-controls")||el.getAttribute("aria-owns")||"").split(/\s+/).filter(Boolean);
       const lists=ids.map(id=>document.getElementById(id)).filter(Boolean);
       if(!lists.length)throw Error("unbound_combobox");
       opts=lists.flatMap(list=>[...list.querySelectorAll("[role=option]")]).filter(o=>visible(o) && norm(o.textContent)===norm(field.value));
       if(opts.length)break;
       await wait(100);
     }
     if(opts.length!==1)throw Error("option_missing_or_ambiguous");
     if(opts[0].tagName==="BUTTON" && opts[0].type!=="button")throw Error("unsafe_option");
     opts[0].click();
   } else throw Error("unsupported_kind");
   await wait(70);
   assertPage();el=resolve(field);
   if(actual(el,field)!==(field.kind==="text"?field.value:norm(field.value)))throw Error("readback_mismatch");
 }
 function resumeInput(provider) {
   const all=[...document.querySelectorAll("input[type=file]")].filter(el=>!el.disabled);
   const candidates=all.filter(el=>{
     let text=label(el);
     if(provider.startsWith("greenhouse") && el.closest("#resume"))text+=" Resume";
     if(/resume|résumé|curriculum vitae|\bcv\b/i.test(text) && !/cover letter/i.test(text))return true;
     let parent=el.parentElement;
     for(let i=0;parent && i<4;i++,parent=parent.parentElement) {
       const labels=[...parent.querySelectorAll("label")].map(x=>norm(x.textContent)).join(" ");
       if(parent.querySelectorAll("input[type=file]").length===1 && /resume|résumé|\bcv\b/i.test(labels) && !/cover letter/i.test(labels))return true;
     }
     return false;
   });
   if(candidates.length!==1)throw Error("Cannot uniquely locate the resume input");
   const input=candidates[0];
   if(input.files?.length)throw Error("A resume is already attached; inspect it before replacing");
   return input;
 }
 function snapshot() {
   return JSON.stringify(controls().map(e=>[label(e),e.value,e.checked,e.getAttribute("aria-invalid")]));
 }
 async function settle(assertPage,min=3500,max=15000) {
   const start=Date.now();let last=snapshot(),same=Date.now();
   while(Date.now()-start<max) {
     await wait(200);assertPage();
     const now=snapshot();
     const busy=document.querySelector('[aria-busy="true"]');
     if(now!==last || busy){same=Date.now();last=now;}
     if(Date.now()-start>=min && Date.now()-same>=1000)return;
   }
   throw Error("Page did not settle; manual inspection required");
 }
 async function prepare(payload, options={}) {
   // Test injection is allowed only on loopback fixtures and never in the packaged popup.
   const testing=options.testURL && ["localhost","127.0.0.1"].includes(location.hostname);
   const pageURL=()=>testing?options.testURL:location.href;
   const assertPage=()=>{if(identity(pageURL())!==payload.identity)throw Error("Page changed or wrong job");};
   assertPage();
   const bytes=Uint8Array.from(atob(payload.base64),c=>c.charCodeAt(0));
   if(bytes.length!==payload.size || await sha256(bytes)!==payload.sha256)throw Error("Browser SHA256 mismatch");
   const input=resumeInput(payload.identity.split("/")[0]);
   // Block accidental native form submit while preparing. No synthetic submit is used.
   const guard=e=>{e.preventDefault();e.stopImmediatePropagation();};
   document.addEventListener("submit",guard,true);
   const result={status:"needs_attention",fileVerified:false,matched:0,verified:0,pending:0,unknownRequired:0,fields:[]};
   try {
     const dt=new DataTransfer();
     dt.items.add(new File([bytes],payload.filename,{type:"application/pdf"}));
     assertPage();input.files=dt.files;
     input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}));
     await settle(assertPage, testing?250:3500, testing?2500:15000);
     for(const field of payload.fields) {
       // Absent common fields are ignored. Duplicate matches are a pending error.
       const exists=controls().some(el=>label(el)===norm(field.label) || (field.kind==="radio" && groupLabel(el)===norm(field.label)));
       if(!exists)continue;
       result.matched++;
       try {await fill(field,assertPage);result.fields.push({label:field.label,ok:true});}
       catch {result.fields.push({label:field.label,ok:false});}
     }
     await settle(assertPage,testing?250:2000,testing?2500:8000);
     const matchedLabels=new Set();
     for(const entry of result.fields) {
       const field=payload.fields.find(f=>f.label===entry.label);
       try {
         const el=resolve(field);matchedLabels.add(el);
         entry.ok=actual(el,field)===(field.kind==="text"?field.value:norm(field.value)) && el.getAttribute("aria-invalid")!=="true" && (!el.validity || el.validity.valid);
       } catch {entry.ok=false;}
     }
     // Re-read bytes, not only the visible filename. If ATS cleared/replaced input,
     // explicitly leave attachment verification pending.
     const current=document.contains(input) && input.files?.length===1 ? input.files[0] : null;
     result.fileVerified=!!current && current.name===payload.filename && current.size===payload.size &&
       await sha256(await current.arrayBuffer())===payload.sha256;
     result.verified=result.fields.filter(f=>f.ok).length;
     result.pending=result.matched-result.verified;
     const matchedGroups=new Set([...matchedLabels].filter(el=>el.type==="radio").map(groupLabel));
     const required=controls().filter(el=>(el.required || el.getAttribute("aria-required")==="true") && !matchedLabels.has(el) && !(el.type==="radio" && matchedGroups.has(groupLabel(el))) && el!==input);
     // Unknown required fields count even when a page has preselected a value.
     const reqKeys=new Set(required.map(el=>el.type==="radio"?groupLabel(el):label(el)||el.id||el.name||el.outerHTML.slice(0,100)));
     result.unknownRequired=reqKeys.size;
     const hiddenRequiredFiles=[...document.querySelectorAll('input[type=file][required]')].filter(el=>el!==input && !el.disabled && !visible(el) && !el.files.length);
     result.unknownRequired+=hiddenRequiredFiles.length;
     // ATS acceptance is distinct from input.files. Require a visible filename too.
     if(!document.body.innerText.includes(payload.filename))result.unknownRequired+=1;
     const errors=[...document.querySelectorAll('[role=alert],[aria-invalid=true],.field-error,.error-message')].filter(visible);
     const captcha=[...document.querySelectorAll('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],[data-sitekey]')].filter(visible);
     if(errors.length || captcha.length)result.unknownRequired+=1;
     result.status=result.matched>0 && result.fileVerified && !result.pending && !result.unknownRequired?"verified":"needs_attention";
     return result;
   } finally {document.removeEventListener("submit",guard,true);}
 }
 globalThis.LedgerPrep={prepare,label,groupLabel,resolve};
})();
