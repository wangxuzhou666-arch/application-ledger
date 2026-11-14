// Loads real React and react-select (pinned CDN ESM builds) for the local acceptance page.
// The markup mirrors the public Greenhouse structure: classNamePrefix "select", a <label>
// referenced by aria-labelledby, and a listbox that only exists while the menu is open.
// "controlled" reproduces the observed Greenhouse wrapper: the page owns menuIsOpen and
// opens it from keyup/mouseup on a div around the control, so react-select's own
// keydown/mousedown opening is ignored. Without it, plain uncontrolled react-select.
import React from "https://cdn.jsdelivr.net/npm/react@18.2.0/+esm";
import {createRoot} from "https://cdn.jsdelivr.net/npm/react-dom@18.2.0/client/+esm";
import {flushSync} from "https://cdn.jsdelivr.net/npm/react-dom@18.2.0/+esm";
import Select,{components} from "https://cdn.jsdelivr.net/npm/react-select@5.8.0/+esm";

const h=React.createElement;
const Control=props=>h("div",{onKeyUp:props.selectProps.onKeyUp,onMouseUp:props.selectProps.onMouseUp},h(components.Control,props));
function ControlledSelect(props) {
 const [open,setOpen]=React.useState(false);
 return h(Select,{...props,components:{Control},menuIsOpen:open,
  onChange:()=>setOpen(false),onBlur:()=>setOpen(false),onMouseUp:()=>setOpen(!open),
  onKeyUp:e=>{if(e.code==="Escape"||e.code==="Tab")setOpen(false);else if(e.code!=="Enter")setOpen(true);}});
}
function mount(host,{id,label,options,required=true,controlled=true}) {
 const root=createRoot(host);
 const props={inputId:id,classNamePrefix:"select","aria-labelledby":id+"-label",required,placeholder:"Select...",
  options:options.map((text,i)=>({value:"v"+i,label:text}))};
 flushSync(()=>root.render(h("div",{className:"select"},h("div",{className:"select__container"},
  h("label",{id:id+"-label",htmlFor:id,className:"label select__label"},label,required?h("span",{"aria-hidden":"true"},"*"):null),
  h(controlled?ControlledSelect:Select,props)))));
 return root;
}
globalThis.ReactSelectFixture={mount,version:React.version};
