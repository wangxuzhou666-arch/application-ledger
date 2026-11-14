/* Shared by the isolated-world adapter and local synthetic acceptance tests. */
(() => {
  const norm = s => String(s || "").replace(/\s*\*\s*$/,"").replace(/\s+/g," ").trim();
  function identity(url) {
    const u = new URL(url), p = u.pathname.replace(/^\/+|\/+$/g,"").split("/");
    // A #fragment never identifies a job: ignore it rather than refuse the page.
    if (u.protocol !== "https:" || u.username || u.password || u.port) throw Error("Unsupported job URL");
    let provider, board, req;
    if (u.hostname === "jobs.ashbyhq.com") {
      if (![2,3].includes(p.length) || (p.length===3 && p[2]!=="application")) throw Error("Open the Ashby application");
      [board,req]=p; provider="ashby";
      if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(req)) throw Error("Invalid job ID");
    } else if (["boards.greenhouse.io","job-boards.greenhouse.io","job-boards.eu.greenhouse.io"].includes(u.hostname)) {
      if (p.join("/")==="embed/job_app") {
        if (u.searchParams.getAll("for").length!==1 || u.searchParams.getAll("token").length!==1) throw Error("Ambiguous job ID");
        board=u.searchParams.get("for");req=u.searchParams.get("token");
      } else if (p.length===3 && p[1]==="jobs") {board=p[0];req=p[2];}
      else throw Error("Open the Greenhouse application");
      provider=u.hostname==="job-boards.eu.greenhouse.io"?"greenhouse-eu":"greenhouse";
      if (!/^\d+$/.test(req)) throw Error("Invalid job ID");
    } else throw Error("Only official Greenhouse/Ashby pages are supported");
    if (!/^[a-z0-9_-]+$/i.test(board)) throw Error("Invalid board");
    return [provider,board,req].join("/").toLowerCase();
  }
  // Whole words only ("embrace", "Certifications" stay fillable). Keep identical to prepare_bridge.PROTECTED.
  const PROTECTED = /\b(?:privacy|consent\w*|agree\w*|signature\w*|e-?sign\w*|certify|attest\w*|captcha|race|racial|ethnic\w*|hispanic|latin[aox]\w*|gender\w*|transgender|sex|sexual|disab\w*|veteran\w*)\b/i;
  const protectedLabel = s => PROTECTED.test(s);
  // Fixed reason codes a preparation report may carry. Keys must equal prepare_bridge.REASONS.
  const REASONS = {
    file_not_shown: "附件区没有显示简历文件名",
    file_input_reset: "页面清空或替换了附件输入框，已按附件区显示的文件名核验",
    file_mismatch: "附件输入框里的文件与批准版本不一致",
    captcha_challenge: "出现需要本人完成的验证码",
    page_error: "页面显示了错误提示",
    unknown_required: "有必填题不在已审答案里",
    unanswered_buttons: "有必填的是/否题没有作答",
    field_readback_failed: "有答案填写后回读不一致",
    combobox_unbound: "下拉框没有给出可核对的选项列表",
    option_not_found: "下拉选项缺失或不唯一"
  };
  const sha256 = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))).map(b=>b.toString(16).padStart(2,"0")).join("");
  globalThis.LedgerCore={norm,identity,protectedLabel,sha256,REASONS};
})();
