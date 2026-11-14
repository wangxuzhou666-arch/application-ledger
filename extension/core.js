/* Shared by the isolated-world adapter and local synthetic acceptance tests. */
(() => {
  const norm = s => String(s || "").replace(/\s*\*\s*$/,"").replace(/\s+/g," ").trim();
  function identity(url) {
    const u = new URL(url), p = u.pathname.replace(/^\/+|\/+$/g,"").split("/");
    if (u.protocol !== "https:" || u.username || u.password || u.port || u.hash) throw Error("Unsupported job URL");
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
  const protectedLabel = s => /privacy|consent|agree|signature|certif|attest|captcha|race|ethnic|gender|disab|veteran/i.test(s);
  const sha256 = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))).map(b=>b.toString(16).padStart(2,"0")).join("");
  globalThis.LedgerCore={norm,identity,protectedLabel,sha256};
})();
