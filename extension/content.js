/* This module never clicks submit/next, presses Enter, or calls form.submit().
   The only buttons it clicks are Yes/No answer buttons that belong to no <form>.
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
 // An ATS field block: Ashby wraps every question in one (even around a fieldset); fieldsets/groups elsewhere.
 const blockOf=el=>el.closest(".ashby-application-form-field-entry") || el.closest("fieldset,[role=group],[role=radiogroup]");
 const blockHead=block=>{
   const ids=block.getAttribute("aria-labelledby");
   return ids ? document.getElementById(ids.split(/\s+/)[0]) : block.querySelector("legend,label");
 };
 function blockLabel(block) {
   if(!block)return "";
   const ids=block.getAttribute("aria-labelledby");
   if(ids)return norm(ids.split(/\s+/).map(id=>document.getElementById(id)?.textContent||"").join(" "));
   return norm(blockHead(block)?.textContent || block.getAttribute("aria-label"));
 }
 // Ashby marks required questions only with a class on the label; Greenhouse appends "*".
 function blockRequired(block) {
   if(!block)return false;
   const head=blockHead(block);
   return block.getAttribute("aria-required")==="true" || (!!head &&
     (/(^|[\s_-])required/i.test(head.getAttribute("class")||"") || !!head.querySelector('[class*="required"]') || /\*\s*$/.test(head.textContent)));
 }
 // Ashby renders a Yes/No question as exactly two plain <button>s in one container.
 function yesnoGroups() {
   const parents=new Set([...document.querySelectorAll("button")].filter(visible).map(b=>b.parentElement));
   return [...parents].filter(p=>{
     const buttons=[...p.querySelectorAll("button")];
     return buttons.length===2 && buttons.every(b=>b.parentElement===p) && buttons.map(b=>norm(b.textContent)).sort().join()==="No,Yes";
   });
 }
 // "Yes" | "No", "" when unanswered, null when the page exposes no pressed state (measured: aria-pressed).
 function yesnoState(group) {
   const buttons=[...group.querySelectorAll("button")];
   const states=buttons.map(b=>b.getAttribute("aria-pressed") ?? b.getAttribute("aria-checked"));
   if(!states.every(s=>s==="true" || s==="false"))return null;
   const on=buttons.filter((b,i)=>states[i]==="true");
   return on.length<2 ? norm(on[0]?.textContent) : null;
 }
 function yesnoButton(field) {
   const value=norm(field.value);
   if(value!=="Yes" && value!=="No")throw Error("unsupported_value");
   const groups=yesnoGroups().filter(g=>blockLabel(blockOf(g))===norm(field.label));
   if(groups.length!==1)throw Error("missing_or_ambiguous");
   const button=[...groups[0].children].find(b=>norm(b.textContent)===value);
   // Ashby leaves these as type=submit. Without an owning form a click cannot submit natively.
   if(button.form!==null)throw Error("unsafe_button");
   return button;
 }
 // An answer only matches a control of its own kind, so a text answer never resolves to a
 // checkbox option that happens to share its label (measured: "LinkedIn" under "How did you hear").
 const TEXTLESS=["file","hidden","checkbox","radio","button","submit","reset","image","password"];
 function fits(el,kind) {
   if(kind==="text")return el.tagName==="TEXTAREA" || (el.tagName==="INPUT" && !TEXTLESS.includes(el.type) && el.getAttribute("role")!=="combobox");
   if(kind==="select")return el.tagName==="SELECT";
   if(kind==="combobox")return el.getAttribute("role")==="combobox";
   return true;
 }
 function resolve(field) {
   if(protectedLabel(field.label))throw Error("protected");
   if(field.kind==="yesno")return yesnoButton(field);
   if(field.kind==="radio") {
     const radios=controls().filter(el=>el.type==="radio" && groupLabel(el)===norm(field.label));
     const groups=new Set(radios.map(el=>el.closest("fieldset,[role=radiogroup]")));
     const chosen=radios.filter(el=>label(el)===norm(field.value));
     if(groups.size!==1 || chosen.length!==1)throw Error("ambiguous_radio");
     return chosen[0];
   }
   const hits=controls().filter(el=>el.type!=="radio" && fits(el,field.kind) && label(el)===norm(field.label));
   if(hits.length!==1)throw Error("missing_or_ambiguous");
   return hits[0];
 }
 // react-select keeps its input empty after a choice and renders the label beside it.
 function shownValue(el) {
   for(let p=el.parentElement,i=0;p && i<3;p=p.parentElement,i++) {
     const shown=p.querySelectorAll('[class*="single-value"],[class*="singleValue"]');
     if(shown.length)return shown.length===1 && p.querySelectorAll("[role=combobox]").length===1 ? norm(shown[0].textContent) : "";
   }
   return "";
 }
 function actual(el,field) {
   if(field.kind==="select")return norm(el.selectedOptions?.[0]?.textContent);
   if(field.kind==="radio")return el.checked ? norm(label(el)) : "";
   if(field.kind==="combobox")return norm(el.value || el.textContent) || shownValue(el);
   if(field.kind==="yesno")return yesnoState(el.parentElement) ?? "";
   return el.value;
 }
 const expected=field=>field.kind==="text"?field.value:norm(field.value);
 // Phone inputs reformat digits ("(267) 231-4745"), and Greenhouse's phone-country picker shows only
 // the dial code ("+1") of the chosen option "United States +1" (both measured 2026-11-14).
 const digits=s=>String(s||"").replace(/\D/g,"");
 function same(el,field) {
   const got=actual(el,field),want=expected(field);
   if(got===want)return true;
   if(field.kind==="text" && el.type==="tel")return digits(got).length>=7 && digits(want).endsWith(digits(got));
   if(field.kind==="combobox" && /^\+\d{1,4}$/.test(got))return want.endsWith(" "+got);
   return false;
 }
 function setText(el,value,{focusout=true}={}) {
   if(!["INPUT","TEXTAREA"].includes(el.tagName) || ["file","hidden","checkbox","radio","button","submit","password"].includes(el.type) || el.readOnly)
     throw Error("unsupported_text");
   const proto=el.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
   Object.getOwnPropertyDescriptor(proto,"value").set.call(el,value);
   el.dispatchEvent(new Event("input",{bubbles:true}));
   el.dispatchEvent(new Event("change",{bubbles:true}));
   el.dispatchEvent(new Event("blur",{bubbles:true}));
   // React's onBlur validation listens to focusout. Comboboxes skip it: it closes their menu.
   if(focusout)el.dispatchEvent(new FocusEvent("focusout",{bubbles:true}));
 }
 const listboxes=el=>(el.getAttribute("aria-controls")||el.getAttribute("aria-owns")||"").split(/\s+/).filter(Boolean)
   .map(id=>document.getElementById(id)).filter(Boolean);
 const key=(el,type,name)=>el.dispatchEvent(new KeyboardEvent(type,{key:name,code:name,bubbles:true,cancelable:true}));
 // One whole keystroke. Plain react-select opens on keydown; the Greenhouse wrapper owns
 // menuIsOpen and only reacts to keyup (measured 2026-11-14). Only ArrowDown/Escape, never Enter.
 const press=(el,name)=>{key(el,"keydown",name);key(el,"keyup",name);};
 const expanded=el=>el.getAttribute("aria-expanded")==="true";
 // Escape first; if the menu is still open, focusout closes react-select and the Greenhouse wrapper alike.
 async function closeMenu(el) {
   if(!expanded(el))return;
   press(el,"Escape");
   await wait(50);
   if(expanded(el))el.dispatchEvent(new FocusEvent("focusout",{bubbles:true}));
   await wait(50);
 }
 async function pickOption(el,field,assertPage) {
   if(el.getAttribute("role")!=="combobox")throw Error("not_combobox");
   // Never click generic buttons, press Enter, or choose an option by keyboard.
   if(el.tagName==="BUTTON" && el.type!=="button")throw Error("unsafe_button");
   // Ashby style: listbox bound while closed, so type to filter. react-select: it exists only while
   // open, so open it and never type (an already open menu is used as it is).
   const boundClosed=!expanded(el) && listboxes(el).length>0;
   el.click();
   if(boundClosed) {if(el.tagName==="INPUT" && !el.readOnly)setText(el,field.value,{focusout:false});}
   else if(!expanded(el))press(el,"ArrowDown");
   let lists=[],opts=[];
   for(let i=0;i<12 && !opts.length;i++) {
     if(i)await wait(100);
     assertPage();
     lists=listboxes(el);
     opts=lists.flatMap(list=>[...list.querySelectorAll("[role=option]")]).filter(o=>visible(o) && norm(o.textContent)===norm(field.value));
   }
   if(!lists.length)throw Error("unbound_combobox");
   if(opts.length!==1)throw Error("option_missing_or_ambiguous");
   if(opts[0].tagName==="BUTTON" && opts[0].type!=="button")throw Error("unsafe_option");
   opts[0].click();
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
   else if(field.kind==="yesno") {if(actual(el,field)!==expected(field))el.click();}
   else if(field.kind==="combobox") {
     // Success closes the menu itself; a failed or abandoned pick must not leave it open.
     try {await pickOption(el,field,assertPage);}
     finally {await wait(50);await closeMenu(el);}
   } else throw Error("unsupported_kind");
   await wait(70);
   assertPage();el=resolve(field);
   if(!same(el,field))throw Error("readback_mismatch");
 }
 function resumeCandidates(provider) {
   const all=[...document.querySelectorAll("input[type=file]")].filter(el=>!el.disabled);
   return all.filter(el=>{
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
 }
 // Widest ancestor whose only form control is el, so filename checks stay inside this field.
 function fieldBlock(el) {
   let block=el.parentElement;
   for(let p=block;p && p!==document.body && !p.matches("form");p=p.parentElement) {
     if([...p.querySelectorAll("input,select,textarea,[role=combobox]")].some(x=>x!==el && x.type!=="hidden"))break;
     block=p;
   }
   return block;
 }
 const DOCUMENT_NAME=/(^|[\s"'(])\w[\w .()-]*\.(pdf|docx?|rtf|txt)(?=$|[\s"'),;])/im;
 // An ATS may show an earlier upload only as text or a remove button next to an empty input.
 const attachmentShown=block=>DOCUMENT_NAME.test(block.innerText) ||
   [...block.querySelectorAll("button,[role=button]")].some(b=>/\b(remove|delete)\b/i.test(b.getAttribute("aria-label")||b.textContent));
 function resumeInput(provider) {
   const candidates=resumeCandidates(provider);
   if(candidates.length!==1)throw Error("Cannot uniquely locate the resume input");
   const input=candidates[0];
   if(input.files?.length || attachmentShown(fieldBlock(input)))throw Error("A resume is already attached; inspect it before replacing");
   return input;
 }
 // Prefer re-hashing the File the page still holds. If the ATS cleared or replaced the input,
 // fall back to the filename shown inside the resume field and say so (file_input_reset).
 async function checkFile(input,block,payload,provider) {
   const found=resumeCandidates(provider);
   const holder=input.isConnected ? input : found.length===1 ? found[0] : null;
   const area=block.isConnected ? block : holder && fieldBlock(holder);
   const shown=!!area && area.innerText.includes(payload.filename);
   const file=holder?.files?.length===1 ? holder.files[0] : null;
   if(!file)return {fileVerified:shown,reason:shown?"file_input_reset":"file_not_shown"};
   const same=file.name===payload.filename && file.size===payload.size && await sha256(await file.arrayBuffer())===payload.sha256;
   return {fileVerified:same,reason:!same?"file_mismatch":shown?null:"file_not_shown"};
 }
 // One entry per question: native controls, radio/checkbox groups, Yes/No pairs and labelled
 // Ashby blocks with an unrecognised widget. `answered` is internal and never leaves this file.
 function questions() {
   const out=[],groups=new Map(),yesno=yesnoGroups();
   const yesnoBlocks=new Set(yesno.map(blockOf).filter(Boolean));
   for(const g of yesno) {
     const block=blockOf(g);
     out.push({kind:"yesno",label:blockLabel(block),els:[...g.children],required:blockRequired(block),options:["Yes","No"],answered:!!yesnoState(g)});
   }
   const els=[...document.querySelectorAll("input,textarea,select,[role=combobox]")].filter(el=>!el.disabled &&
     !["hidden","submit","button","reset","image"].includes(el.type) && el.getAttribute("aria-hidden")!=="true" &&
     (el.type==="file" || visible(el)) && !yesnoBlocks.has(blockOf(el)));
   for(const el of els) {
     const block=blockOf(el), required=el.required || el.getAttribute("aria-required")==="true" || blockRequired(block);
     if(el.type==="radio" || el.type==="checkbox") {
       const set=el.closest(el.type==="radio"?"fieldset,[role=radiogroup]":"fieldset,[role=group]");
       const grouped=el.type==="radio" || (set && set.querySelectorAll("input[type=checkbox]").length>1);
       const id=!grouped ? el : set || "radio:"+el.name;
       if(!groups.has(id)) {
         groups.set(id,{kind:el.type,label:(grouped?groupLabel(el):label(el)) || blockLabel(block),els:[],required:false,options:grouped?[]:null,answered:false});
         out.push(groups.get(id));
       }
       const q=groups.get(id);
       q.els.push(el);q.required ||= required;q.answered ||= el.checked;
       if(grouped)q.options.push(label(el));
       continue;
     }
     const kind=el.type==="file"?"file":el.getAttribute("role")==="combobox"?"combobox":el.tagName==="SELECT"?"select":"text";
     const answered=kind==="file"?el.files.length>0:kind==="combobox"?!!(norm(el.value)||shownValue(el)):String(el.value||"").trim()!=="";
     out.push({kind,label:(kind==="file"?blockLabel(block)||label(el):label(el)||blockLabel(block)),els:[el],required,answered,
       options:kind==="select"?[...el.options].filter(o=>o.value!=="" && !o.disabled).map(o=>norm(o.textContent)):null});
   }
   const placed=out.flatMap(q=>q.els);
   for(const block of document.querySelectorAll(".ashby-application-form-field-entry")) {
     if(!placed.some(el=>block.contains(el)) && blockLabel(block))
       out.push({kind:"unsupported",label:blockLabel(block),els:[],required:blockRequired(block),options:null,answered:false});
   }
   return out;
 }
 // Only a challenge the applicant must complete counts. The invisible-mode reCAPTCHA badge
 // (.grecaptcha-badge and its anchor iframe) is always visible on Greenhouse and is not one.
 function captchaChallenge() {
   const widgets=[...document.querySelectorAll('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="challenges.cloudflare.com"],[data-sitekey]:not([data-size=invisible])')];
   return widgets.some(w=>{
     const r=w.getBoundingClientRect();
     return visible(w) && !w.closest(".grecaptcha-badge") && !/[?&#]size=invisible\b/.test(w.getAttribute("src")||"") &&
       r.width>0 && r.height>0 && r.bottom>0 && r.right>0;
   });
 }
 function snapshot() {
   return JSON.stringify([controls().map(e=>[label(e),e.value,e.checked,e.getAttribute("aria-invalid")]),yesnoGroups().map(yesnoState)]);
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
 const FILL_REASONS={unbound_combobox:"combobox_unbound",option_missing_or_ambiguous:"option_not_found"};
 async function prepare(payload, options={}) {
   // Test injection is allowed only on loopback fixtures and never in the packaged popup.
   const testing=options.testURL && ["localhost","127.0.0.1"].includes(location.hostname);
   const pageURL=()=>testing?options.testURL:location.href;
   const assertPage=()=>{if(identity(pageURL())!==payload.identity)throw Error("Page changed or wrong job");};
   assertPage();
   const bytes=Uint8Array.from(atob(payload.base64),c=>c.charCodeAt(0));
   if(bytes.length!==payload.size || await sha256(bytes)!==payload.sha256)throw Error("Browser SHA256 mismatch");
   const provider=payload.identity.split("/")[0];
   const input=resumeInput(provider), block=fieldBlock(input);
   // Block accidental native form submit while preparing. No synthetic submit is used.
   const guard=e=>{e.preventDefault();e.stopImmediatePropagation();};
   document.addEventListener("submit",guard,true);
   const result={status:"needs_attention",fileVerified:false,matched:0,verified:0,pending:0,unansweredRequired:0,reasons:[]};
   const reasons=new Set(),entries=[];
   try {
     const dt=new DataTransfer();
     dt.items.add(new File([bytes],payload.filename,{type:"application/pdf"}));
     assertPage();input.files=dt.files;
     input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}));
     await settle(assertPage, testing?250:3500, testing?2500:15000);
     for(const field of payload.fields) {
       // Absent common fields are ignored. Duplicate matches are a pending error.
       const exists=field.kind==="yesno" ? yesnoGroups().some(g=>blockLabel(blockOf(g))===norm(field.label)) :
         controls().some(el=>(label(el)===norm(field.label) && fits(el,field.kind)) || (field.kind==="radio" && groupLabel(el)===norm(field.label)));
       if(!exists)continue;
       result.matched++;
       const entry={field,ok:true,reason:null};entries.push(entry);
       try {await fill(field,assertPage);}
       catch(e) {entry.ok=false;entry.reason=FILL_REASONS[e.message]||"field_readback_failed";}
     }
     await settle(assertPage,testing?250:2000,testing?2500:8000);
     const resolved=new Set();
     for(const entry of entries) {
       try {
         const el=resolve(entry.field);resolved.add(el);
         entry.ok=same(el,entry.field) && el.getAttribute("aria-invalid")!=="true" && (!el.validity || el.validity.valid);
       } catch {entry.ok=false;}
       if(!entry.ok)reasons.add(entry.reason||"field_readback_failed");
     }
     const file=await checkFile(input,block,payload,provider);
     result.fileVerified=file.fileVerified;
     if(file.reason)reasons.add(file.reason);
     result.verified=entries.filter(e=>e.ok).length;
     result.pending=result.matched-result.verified;
     // Required questions outside the reviewed answers. A page-prefilled value still needs review,
     // but only empty ones count as unanswered.
     const resumeEls=new Set([input,...resumeCandidates(provider)]);
     for(const q of questions()) {
       if(!q.required || q.els.some(el=>resumeEls.has(el) || resolved.has(el)))continue;
       if(!q.answered)result.unansweredRequired++;
       reasons.add(q.kind==="yesno" && !q.answered ? "unanswered_buttons" : "unknown_required");
     }
     if([...document.querySelectorAll('[role=alert],[aria-invalid=true],.field-error,.error-message')].some(visible))reasons.add("page_error");
     if(captchaChallenge())reasons.add("captcha_challenge");
     result.reasons=[...reasons];
     const blocking=result.reasons.some(r=>r!=="file_input_reset");
     result.status=result.matched>0 && result.fileVerified && !result.pending && !result.unansweredRequired && !blocking?"verified":"needs_attention";
     return result;
   } finally {document.removeEventListener("submit",guard,true);}
 }
 // Network-backed searches are never opened or typed into during a scan.
 const SEARCHED=/\b(location|city|cities|school|university|college|institution|address)\b/i;
 async function comboOptions(el) {
   if(!listboxes(el).length)press(el,"ArrowDown");
   let found=[];
   for(let i=0;i<10 && !found.length;i++) {
     await wait(100);
     found=listboxes(el).flatMap(list=>[...list.querySelectorAll("[role=option]")]);
   }
   await closeMenu(el);
   return found.length ? found.map(o=>norm(o.textContent)) : null;
 }
 // Read-only question list for preparing answers: no upload, no filling, no values.
 async function scan() {
   const out=[];
   for(const q of questions()) {
     const isProtected=protectedLabel(q.label);
     let options=q.options;
     if(q.kind==="combobox")options=isProtected || SEARCHED.test(q.label) ? null : await comboOptions(q.els[0]);
     out.push({label:q.label.slice(0,300),kind:q.kind,required:q.required,protected:isProtected,
       options:options && options.slice(0,30).map(o=>o.slice(0,150)),optionsTruncated:!!options && options.length>30});
   }
   return {questions:out.slice(0,150)};
 }
 globalThis.LedgerPrep={prepare,scan,label,groupLabel,resolve};
})();
