const output=document.querySelector("#status"),button=document.querySelector("#prepare");
function show(r){
 if(r.error){output.textContent="已停止："+r.error+"\n没有提交申请；请检查附件和页面后再操作。";return;}
 output.textContent=(r.status==="verified"?"本轮回读通过":"需要检查")+
 "\nPDF 指纹回读："+(r.fileVerified?"一致":"待核实")+
 "\n答案核对："+r.verified+"/"+r.matched+
 "\n待处理："+(r.pending+r.unknownRequired)+
 "\n看板："+(r.boardRefreshed?"已更新":"未刷新，可运行工作台 board")+
 "\n未提交申请。";
}
(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
 const old=(await chrome.storage.session.get("tab"+tab.id))["tab"+tab.id];
 try {if(old && old.identity===LedgerCore.identity(tab.url)){show(old);output.textContent+="\n上次快照："+old.at;}}
 catch {output.textContent="请打开官方 Greenhouse 或 Ashby 申请页。";button.disabled=true;}
 button.onclick=async()=>{button.disabled=true;output.textContent="正在核对批准版本、填写并等待页面解析…";
 try {const res=await chrome.runtime.sendMessage({op:"prepare",tabId:tab.id});show(res.ok?res.data:{error:res.error});}
 catch(e){show({error:e.message});}finally{button.disabled=false;}};
})();
