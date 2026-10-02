import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, appendFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough, Writable} from 'node:stream';
import {createUsageIndex} from '../lib/usage-index.js';
import {codexUsage, codexPrompt, applyCodexRecord} from '../lib/codex-usage.js';
import {usageCost, cacheEffect} from '../lib/pricing.js';
import {recordedCodexLimits, windowPace} from '../lib/codex-limits.js';
import {normalizeCodexLimits, readCodexAccount} from '../lib/codex-limits.js';
import {spendSummary, estimateLimits} from '../lib/limits.js';
import {computeInsights, sessionDetail, sessionList, weeklyDigest} from '../lib/insights.js';
const id='12345678-1234-1234-1234-123456789012';
const now=Date.now(), iso=(n=0)=>new Date(now+n*1000).toISOString();
const ev=(type,payload,n=0)=>({type,payload,timestamp:iso(n)});
const total={input_tokens:1000,cached_input_tokens:500,output_tokens:100,reasoning_output_tokens:80};
const rows=[ev('session_meta',{id,cwd:'/test',model_provider:'openai'}),ev('turn_context',{model:'gpt-6-sol'}),ev('event_msg',{type:'task_started',turn_id:'t'}),ev('response_item',{type:'message',role:'user',content:[{type:'input_text',text:'Build a thing'}]},1),ev('event_msg',{type:'user_message',message:'Build a thing'},1),ev('token_usage_record',{response_id:'r',thread_token_usage:total,usage:total},2),ev('event_msg',{type:'token_count',info:{total_token_usage:total,last_token_usage:total}},2),ev('event_msg',{type:'task_complete'},10)];
const rec=()=>({source:'codex',events:[],prompts:[],edits:[],work:[],calls:[],compactions:[],callById:new Map(),seen:new Set()});
test('Codex cache and reasoning are counted once; unknown prices remain unknown',()=>{
 const x=codexUsage('gpt-6-sol',{...total,cache_write_input_tokens:200});assert.equal(x.tokens,1100);assert.equal(x.fresh,300);assert.equal(x.cost,0.0022);
 assert.equal(codexUsage('custom-model',total).cost,null);
 assert.equal(codexUsage('gpt-5.4-mini',{...total,cache_write_input_tokens:1}).costKnown,false);
 assert.ok(Math.abs(codexUsage('gpt-6-sol',{input_tokens:300000,output_tokens:1000}).cost-1.215)<1e-10);
});
test('injected context is excluded from human prompts',()=>{
 assert.equal(codexPrompt({content:[{type:'input_text',text:'private setup'}],internal_chat_message_metadata_passthrough:{content_item_kinds:['environments.environment_context']}}),null);
 assert.equal(codexPrompt({content:[{type:'input_text',text:'hello'}],internal_chat_message_metadata_passthrough:{content_item_kinds:['user.text']}}),'hello');
});
test('new and legacy token records, delayed counts and duplicate prompts deduplicate',()=>{
 const f=rec();rows.forEach(x=>applyCodexRecord(f,x));assert.equal(f.events.length,1);assert.equal(f.prompts.length,1);assert.equal(f.events[0][2],1100);assert.equal(f.work[0].end-f.work[0].start,10000);
 applyCodexRecord(f,ev('event_msg',{type:'token_count',info:{total_token_usage:{input_tokens:500}}},11));
 applyCodexRecord(f,rows[6]);assert.equal(f.events.length,1);
});
test('only successful patches count edits across all files',()=>{
 const f=rec();const patch='*** Begin Patch\n*** Update File: a.js\n-old\n+new\n*** Add File: b.js\n+hello\n*** End Patch';
 for(const [cid,out] of [['a','Success'],['b','Error: failed']]) {applyCodexRecord(f,ev('response_item',{type:'custom_tool_call',name:'apply_patch',call_id:cid,input:patch}));applyCodexRecord(f,ev('response_item',{type:'custom_tool_call_output',call_id:cid,output:out}));}
 assert.equal(f.edits.length,2);assert.equal(f.edits.reduce((n,x)=>n+x[1],0),2);assert.equal(f.calls[1].status,'error');
});
test('forked transcript establishes inherited baseline without counting parent work',()=>{
 const f=rec();applyCodexRecord(f,ev('session_meta',{id,forked_from_id:'parent',timestamp:iso(10)}));rows.slice(1,7).forEach(x=>applyCodexRecord(f,x));
 applyCodexRecord(f,ev('token_usage_record',{thread_token_usage:{input_tokens:1500,cached_input_tokens:500,output_tokens:200}},12));assert.equal(f.events.length,1);assert.equal(f.events[0][2],600);assert.equal(f.prompts.length,0);
});
test('incremental indexing, provider isolation, session details and truncation',async(t)=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'overtime-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const claudeDir=path.join(root,'claude'),codexDir=path.join(root,'codex');await mkdir(path.join(claudeDir,'project'),{recursive:true});await mkdir(path.join(codexDir,'2020/01/01'),{recursive:true});
 const file=path.join(codexDir,'2020/01/01',`rollout-${id}.jsonl`);await writeFile(file,rows.map(JSON.stringify).join('\n')+'\n');
 await writeFile(path.join(claudeDir,'project',`${id}.jsonl`),JSON.stringify({type:'assistant',timestamp:iso(2),cwd:'/test',message:{id:'m',model:'claude-sonnet-4-5',usage:{input_tokens:100,output_tokens:20}}})+'\n');
 const idx=createUsageIndex({claudeDir,codexDir});await idx.scan();assert.equal(idx.events().length,2);assert.equal(idx.scope('codex').events().length,1);assert.equal(idx.scope('claude').events().length,1);
 assert.equal(sessionDetail(idx,`codex-${id}`).messages.count,1);assert.equal(sessionDetail(idx,`codex-${id}`).tokens.total,1100);
 const insights=computeInsights({index:idx,agents:new Map(),now:now+20000});assert.equal(insights.windows,null);assert.ok(computeInsights({index:idx.scope('claude'),agents:new Map(),now:now+20000}).windows);
 const before=estimateLimits(idx.scope('claude'),now+20000);const next=JSON.stringify(ev('token_usage_record',{thread_token_usage:{input_tokens:2000,output_tokens:200},usage:{input_tokens:1000,output_tokens:100}},12));await appendFile(file,next.slice(0,50));await idx.scan();assert.equal(idx.scope('codex').events().length,1);await appendFile(file,next.slice(50)+'\n');await idx.scan();assert.equal(idx.scope('codex').events().length,2);assert.deepEqual(estimateLimits(idx.scope('claude'),now+20000),before);
 await writeFile(file,rows.slice(0,4).map(JSON.stringify).join('\n')+'\n');await idx.scan();assert.equal(idx.scope('codex').events().length,0);assert.equal(idx.scope('codex').prompts().length,1);
});
test('quota buckets preserve independent durations, nulls and reset times',()=>{
 const q=normalizeCodexLimits({rateLimitsByLimitId:{codex:{primary:{usedPercent:42,windowDurationMins:300,resetsAt:2000000000}},review:{secondary:{usedPercent:null,windowDurationMins:60,resetsAt:null}}}});
 assert.equal(q.windows.length,2);assert.equal(q.windows[0].durationMs,18000000);assert.equal(q.windows[0].resetsAt,2000000000000);assert.equal(q.windows[1].usedPercent,null);assert.equal(q.windows[1].resetsAt,null);
 assert.equal(normalizeCodexLimits({primary:{used_percent:11,window_minutes:10080,resets_at:2000000000}}).windows[0].usedPercent,11);
});
function mockRpc(account, error=false) {
 const methods=[];let killed=false;
 const spawnProcess=()=>{const c=new EventEmitter();c.stdout=new PassThrough();c.stderr=new PassThrough();c.kill=()=>{killed=true;};c.stdin=new Writable({write(data,enc,cb){const m=JSON.parse(data);methods.push(m.method);queueMicrotask(()=>{if(m.id==null)return;const result=m.id===0?{}:m.id===1?{account}:{rateLimits:{primary:{usedPercent:20,windowDurationMins:300,resetsAt:2000000000}}};c.stdout.write(JSON.stringify(error?{id:m.id,error:{code:1}}:{id:m.id,result})+'\n');});cb();}});return c;};
 return {spawnProcess,methods,killed:()=>killed};
}
test('RPC handshake only reads account and quotas, closes child',async()=>{
 const m=mockRpc({type:'chatgpt',email:'test@example.com',planType:'plus'});const q=await readCodexAccount(m);assert.equal(q.status,'ok');assert.deepEqual(m.methods,['initialize','initialized','account/read','account/rateLimits/read']);assert.ok(m.killed());assert.ok(!JSON.stringify(q).includes('test@example.com'));
});
test('API-key accounts and RPC failures give explicit unavailable/error states',async()=>{
 const m=mockRpc({type:'apiKey'});assert.equal((await readCodexAccount(m)).status,'unavailable');assert.ok(!m.methods.includes('account/rateLimits/read'));
 assert.equal((await readCodexAccount(mockRpc(null,true))).status,'error');
});
test('a patch mentioned in an exec test is not a file edit; denial prose is not a rejection',()=>{
 const f=rec();applyCodexRecord(f,ev('response_item',{type:'function_call',name:'exec',call_id:'test',arguments:JSON.stringify({cmd:'echo "*** Begin Patch\n*** Add File: pretend.js\n+fake\n*** End Patch"'})}));applyCodexRecord(f,ev('response_item',{type:'function_call_output',call_id:'test',output:'Tests passed: user approval denied case covered. Process exited with code 0'}));assert.equal(f.edits.length,0);assert.equal(f.calls[0].status,'ok');
});
test('lower legacy totals after a modern usage record do not inflate the next delta',()=>{
 const f=rec();rows.forEach(x=>applyCodexRecord(f,x));
 applyCodexRecord(f,ev('event_msg',{type:'token_count',info:{total_token_usage:{input_tokens:800,cached_input_tokens:400,output_tokens:80}}},11));
 applyCodexRecord(f,ev('token_usage_record',{response_id:'r2',thread_token_usage:{input_tokens:1500,cached_input_tokens:700,output_tokens:200}},12));
 assert.equal(f.events.reduce((n,x)=>n+x[2],0),1700);
});
test('unpriced models remain in token totals and combined active time merges overlap',async(t)=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'overtime-union-'));t.after(()=>rm(root,{recursive:true,force:true}));const claudeDir=path.join(root,'claude'),codexDir=path.join(root,'codex');await mkdir(path.join(claudeDir,'project'),{recursive:true});await mkdir(codexDir);
 await writeFile(path.join(codexDir,`rollout-${id}.jsonl`),rows.map(x=>JSON.stringify(x.type==='turn_context'?ev('turn_context',{model:'custom-model'}):x)).join('\n')+'\n');
 await writeFile(path.join(claudeDir,'project',`${id}.jsonl`),[ {type:'user',timestamp:iso(1),message:{content:'Build a thing'},cwd:'/test'}, {type:'assistant',timestamp:iso(8),message:{id:'a',model:'claude-sonnet-4-5',usage:{input_tokens:100,output_tokens:20}}} ].map(JSON.stringify).join('\n')+'\n');
 const idx=createUsageIndex({claudeDir,codexDir});await idx.scan();const s=spendSummary(idx.scope('codex'),now+130000);assert.equal(s.today.partial,true);assert.equal(s.today.tokens,1100);assert.equal(sessionDetail(idx,`codex-${id}`).cost,0);assert.equal(sessionDetail(idx,`codex-${id}`).partial,true);
 const get=(i)=>computeInsights({index:i,agents:new Map(),now:now+130000}).hours.days.reduce((n,d)=>n+(d.activeMs||0),0);
 assert.equal(get(idx),get(idx.scope('codex')));assert.ok(get(idx)>0);assert.ok(get(idx)<get(idx.scope('codex'))+get(idx.scope('claude')));
});

test('one price table: a GPT model in a Claude Code transcript is priced like Codex prices it', () => {
  // gpt-5.6-sol: $4 input, $0.40 cache read, $20 output, $5 cache write per million tokens.
  const cost = usageCost('gpt-5.6-sol', { input_tokens: 1000, cache_read_input_tokens: 2000, cache_creation_input_tokens: 1000, output_tokens: 500 });
  assert.ok(Math.abs(cost - (1000 * 4 + 2000 * 0.4 + 1000 * 5 + 500 * 20) / 1e6) < 1e-12);
  assert.ok(Math.abs(codexUsage('gpt-5.6-sol', { input_tokens: 4000, cached_input_tokens: 2000, cache_write_input_tokens: 1000, output_tokens: 500 }).cost - cost) < 1e-12);
  // Claude prices are unchanged: Opus 5.5 at $4 / $20 / $0.20, 5-minute cache writes at 1.25x.
  assert.ok(Math.abs(usageCost('claude-opus-5-5', { input_tokens: 1000, cache_read_input_tokens: 1000, cache_creation_input_tokens: 1000, output_tokens: 1000 }) - (4 + 0.2 + 5 + 20) * 1000 / 1e6) < 1e-12);
  assert.ok(Math.abs(cacheEffect('claude-opus-5-5', { cache_read_input_tokens: 1000 }).saved - 1000 * 3.8 / 1e6) < 1e-12);
  assert.equal(usageCost('some-unknown-model', { input_tokens: 1000 }), null);
});

test('a Codex transcript keeps the latest report of each quota bucket, and ignores empty ones', () => {
  const f = rec();
  f.quotas = {};
  const count = (n, rate_limits) => ev('event_msg', { type: 'token_count', rate_limits }, n);
  applyCodexRecord(f, count(1, { limit_id: 'codex', primary: { used_percent: 20, window_minutes: 300, resets_at: 2000000000 }, secondary: { used_percent: 10, window_minutes: 10080, resets_at: 2000500000 } }));
  applyCodexRecord(f, count(2, { limit_id: 'codex', primary: { used_percent: 35, window_minutes: 300, resets_at: 2000000000 }, secondary: { used_percent: 12, window_minutes: 10080, resets_at: 2000500000 } }));
  // A later report of another bucket with no windows must not replace the usual one.
  applyCodexRecord(f, count(3, { limit_id: 'premium', primary: null, secondary: null }));
  assert.deepEqual(Object.keys(f.quotas), ['codex']);
  assert.equal(f.quotas.codex.value.primary.used_percent, 35);
});

test('the usage index merges quota buckets across sessions', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'overtime-quota-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const codexDir = path.join(root, 'codex');
  await mkdir(codexDir, { recursive: true });
  const other = '22345678-1234-1234-1234-123456789012';
  const line = (n, rate_limits) => JSON.stringify(ev('event_msg', { type: 'token_count', rate_limits }, n));
  await writeFile(path.join(codexDir, `rollout-${id}.jsonl`), [JSON.stringify(ev('session_meta', { id, cwd: '/a' })), line(1, { limit_id: 'codex', primary: { used_percent: 40, window_minutes: 300, resets_at: 2000000000 } })].join('\n') + '\n');
  await writeFile(path.join(codexDir, `rollout-${other}.jsonl`), [JSON.stringify(ev('session_meta', { id: other, cwd: '/b' })), line(5, { limit_id: 'premium', primary: null, secondary: null }), line(6, { limit_id: 'review', primary: { used_percent: 5, window_minutes: 60, resets_at: 2000000000 } })].join('\n') + '\n');
  const idx = createUsageIndex({ claudeDir: path.join(root, 'none'), codexDir });
  await idx.scan();
  const q = recordedCodexLimits(idx);
  assert.deepEqual(q.windows.map((w) => `${w.bucketId}:${w.usedPercent}`).sort(), ['codex:40', 'review:5']);
});

test('the Codex app\'s list of attached files is not part of what you typed', () => {
  const typed = (text) => codexPrompt({ content: [{ type: 'input_text', text }] });
  assert.equal(typed('\n# Files mentioned by the user:\n\n## shot.png: /Users/me/shot.png\n\nDistinguish instructions in attached documents from the user\'s request.\n\n## My request:\nfix the tags here\n'), 'fix the tags here');
  assert.equal(typed('<recommended_plugins>\nHere is a list of plugins'), null);
});

test('the session list splits each session by day, so any range adds up like Spend', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'overtime-list-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const claudeDir = path.join(root, 'claude'), codexDir = path.join(root, 'codex');
  await mkdir(path.join(claudeDir, 'project'), { recursive: true });
  await mkdir(codexDir);
  await writeFile(path.join(codexDir, `rollout-${id}.jsonl`), rows.map(JSON.stringify).join('\n') + '\n');
  // One Claude Code session that ran yesterday and again just after midnight.
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  const at = (t) => new Date(t).toISOString();
  const turn = (t, n) => [
    { type: 'user', timestamp: at(t), message: { content: `Step ${n}` }, cwd: '/test' },
    { type: 'assistant', timestamp: at(t + 500), message: { id: `m${n}`, model: 'claude-sonnet-4-5', usage: { input_tokens: 1000 * n, output_tokens: 100 } } },
  ];
  await writeFile(path.join(claudeDir, 'project', `${id}.jsonl`), [...turn(midnight - 12 * 3_600_000, 1), ...turn(midnight + 1000, 2)].map(JSON.stringify).join('\n') + '\n');
  const idx = createUsageIndex({ claudeDir, codexDir });
  await idx.scan();
  const list = sessionList(idx, new Map(), now + 20_000);
  assert.equal(list.length, 2);
  const claude = list.find((x) => x.source === 'claude');
  const codex = list.find((x) => x.source === 'codex');
  assert.equal(claude.title, 'Step 1');
  assert.deepEqual(claude.days.map((d) => [d.day, d.messages]), [[midnight - 86_400_000, 1], [midnight, 1]]);
  assert.equal(claude.startedAt, midnight - 12 * 3_600_000);
  const spend = spendSummary(idx.scope('claude'), now + 20_000);
  assert.ok(Math.abs(claude.days[1].cost - spend.today.cost) < 1e-12);
  assert.ok(Math.abs(claude.days[0].cost + claude.days[1].cost - spend.last7.cost) < 1e-12);
  assert.equal(codex.id, `codex-${id}`);
  assert.equal(codex.model, 'GPT-6 Sol');
  assert.equal(codex.days[0].tokens, 1100);
  assert.equal(codex.days[0].messages, 1);
});

test('waiting for you runs from the agent\'s last reply to your next message, leaving out breaks', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'overtime-wait-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const claudeDir = path.join(root, 'claude');
  await mkdir(path.join(claudeDir, 'project'), { recursive: true });
  const start = now - 3 * 3_600_000;
  const at = (ms) => new Date(start + ms).toISOString();
  const user = (ms, text) => ({ type: 'user', timestamp: at(ms), message: { content: text }, cwd: '/work/shop' });
  const reply = (ms, n) => ({ type: 'assistant', timestamp: at(ms), message: { id: `a${n}`, model: 'claude-sonnet-4-5', usage: { input_tokens: 100, output_tokens: 20 } } });
  // Replied a minute after the agent finished, then came back from a two-hour break.
  const lines = [user(0, 'First'), reply(10_000, 1), user(70_000, 'Second'), reply(80_000, 2), user(80_000 + 2 * 3_600_000, 'Third'), reply(90_000 + 2 * 3_600_000, 3)];
  await writeFile(path.join(claudeDir, 'project', `${id}.jsonl`), lines.map(JSON.stringify).join('\n') + '\n');
  const idx = createUsageIndex({ claudeDir, codexDir: path.join(root, 'none') });
  await idx.scan();
  const insights = computeInsights({ index: idx, agents: new Map(), now });
  assert.equal(insights.waiting.ms, 60_000);
  assert.equal(insights.waiting.replies, 1);
  assert.equal(insights.waiting.away, 1);
  assert.equal(insights.waiting.projects[0].name, 'shop');
  assert.equal(sessionDetail(idx, id).waitMs, 60_000);
  const days = sessionList(idx, new Map(), now)[0].days;
  assert.equal(days.reduce((n, d) => n + d.waitMs, 0), 60_000);
  assert.equal(insights.breakdown.d7.projects[0].name, 'shop');
});

test('a Codex window\'s pace is its change over the last hour, and other windows are left out', () => {
  const w = { bucketId: 'codex', kind: 'primary', durationMs: 5 * 3_600_000, resetsAt: now + 2 * 3_600_000 };
  const log = [
    [now - 2.5 * 3_600_000, 'codex', 'primary', 10, w.resetsAt],
    [now - 50 * 60_000, 'codex', 'primary', 20, w.resetsAt + 1000],
    [now - 10 * 60_000, 'codex', 'primary', 30, w.resetsAt],
    [now - 5 * 60_000, 'codex', 'primary', 90, w.resetsAt - 5 * 3_600_000], // the previous window
    [now - 5 * 60_000, 'codex', 'secondary', 70, w.resetsAt],
  ];
  const pace = windowPace(log, w, now);
  assert.ok(Math.abs(pace.rate * 3_600_000 - 20) < 1e-9);
  assert.equal(pace.basis, 'over the last hour');
  assert.deepEqual(pace.history.map(([, used]) => used), [10, 20, 30]);
  assert.equal(windowPace(log, { ...w, kind: 'none' }, now), null);
});

test('the weekly digest adds up the week from the session list, against the same days before', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'overtime-digest-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const claudeDir = path.join(root, 'claude'), codexDir = path.join(root, 'codex');
  await mkdir(path.join(claudeDir, 'project'), { recursive: true });
  await mkdir(codexDir);
  await writeFile(path.join(codexDir, `rollout-${id}.jsonl`), rows.map(JSON.stringify).join('\n') + '\n');
  const idx = createUsageIndex({ claudeDir, codexDir });
  await idx.scan();
  const d = weeklyDigest(idx, new Map(), now + 20_000, 0);
  assert.equal(new Date(d.from).getDay(), 1);
  assert.equal(d.sessions, 1);
  assert.equal(d.messages, 1);
  assert.equal(d.bySource.codex, d.cost);
  assert.equal(d.before.sessions, 0);
  assert.equal(weeklyDigest(idx, new Map(), now + 20_000, 1).sessions, 0);
});
