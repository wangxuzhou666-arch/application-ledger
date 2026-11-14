const {test}=require("node:test");
const assert=require("node:assert/strict");
require("../core.js");
const c=globalThis.LedgerCore;
test("canonical Greenhouse and Ashby identity",()=>{
 assert.equal(c.identity("https://job-boards.greenhouse.io/demo/jobs/123?gh_src=abc"),"greenhouse/demo/123");
 assert.equal(c.identity("https://boards.greenhouse.io/embed/job_app?for=demo&token=123"),"greenhouse/demo/123");
 assert.equal(c.identity("https://jobs.ashbyhq.com/demo/12345678-1234-1234-1234-123456789abc/application"),"ashby/demo/12345678-1234-1234-1234-123456789abc");
});
test("reject unsupported and ambiguous targets",()=>{
 for(const url of ["https://evil.example/demo/jobs/123","http://job-boards.greenhouse.io/demo/jobs/123",
 "https://boards.greenhouse.io/embed/job_app?for=a&for=b&token=123"])
 assert.throws(()=>c.identity(url));
});
test("fragment ignored, same identity as Python bridge",()=>{
 assert.equal(c.identity("https://job-boards.greenhouse.io/demo/jobs/123#changed"),"greenhouse/demo/123");
 assert.equal(c.identity("https://jobs.ashbyhq.com/demo/12345678-1234-1234-1234-123456789abc/application#form"),"ashby/demo/12345678-1234-1234-1234-123456789abc");
});
test("protected labels by whole word (shared table with Python)",()=>{
 const table=require("./protected-labels.json");
 for(const text of table.protected)assert.ok(c.protectedLabel(text),text);
 for(const text of table.fillable)assert.equal(c.protectedLabel(text),false,text);
});
test("exact label normalization only",()=>{
 assert.equal(c.norm("First Name *"),"First Name");assert.notEqual(c.norm("Name"),c.norm("First Name"));
});
test("deterministic SHA256",async()=>assert.equal(await c.sha256(new TextEncoder().encode("abc")),"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
