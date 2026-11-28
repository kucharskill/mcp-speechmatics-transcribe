import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

test("usage rotation, concurrent high-water updates, history migration, and transparent refresh", async () => {
  await mkdir(".tmp", { recursive: true });
  const directory = await mkdtemp(resolve(".tmp", "usage-"));
  const moduleUrl = (name) => pathToFileURL(resolve("modules", name + ".js")).href;
  const script = `
    import assert from 'node:assert/strict';
    import {mkdir,writeFile,rm,readFile} from 'node:fs/promises';
    import {createHash} from 'node:crypto';
    import {join} from 'node:path';
    import {readLog,updateUsage,reserveToken,updateRecord,logPath} from ${JSON.stringify(moduleUrl("history"))};
    import {refreshUsage} from ${JSON.stringify(moduleUrl("usage"))};
    import {transcribe} from ${JSON.stringify(moduleUrl("transcribe"))};
    const tokens=[{login:'account-a',token:'private-token-a'},{login:'account-b',token:'private-token-b'}];
    const sha=t=>createHash('sha256').update(t.token).digest('hex');
    const snapshot=(token,hours,until='2026-11-28')=>({tokenSha256:sha(token),since:'1970-01-01',until,requestedAt:'2026-01-01T00:00:00.000Z',durationSeconds:hours*3600,durationHours:Math.round(hours*10)/10,count:1});
    await mkdir(join(process.env.TEMP,'transcription'),{recursive:true});
    await writeFile(logPath,JSON.stringify([{id:'old',status:'success',tokenSha256:sha(tokens[0])}]));
    assert.equal((await readLog()).transcriptions[0].id,'old');
    await Promise.all([updateUsage(snapshot(tokens[0],20)),updateUsage(snapshot(tokens[1],10.04)),updateUsage(snapshot(tokens[1],10.03)),updateUsage(snapshot(tokens[1],9))]);
    assert.equal((await readLog()).usage.find(x=>x.tokenSha256===sha(tokens[1])).durationSeconds,10.04*3600);
    const first=await reserveToken(tokens,{id:'one',startedAt:new Date().toISOString()});
    assert.equal(first.sha,sha(tokens[1]));
    const second=await reserveToken(tokens,{id:'two',startedAt:new Date().toISOString()});
    assert.equal(second.sha,sha(tokens[0]));
    await updateRecord({id:'one',status:'success',finishedAt:new Date().toISOString(),audioDurationSeconds:72000});
    await updateRecord({id:'two',status:'success',finishedAt:new Date().toISOString(),audioDurationSeconds:0});
    assert.equal((await reserveToken(tokens,{id:'three'})).sha,sha(tokens[0]));
    await updateRecord({id:'three',status:'error',tokenDisabled:true});
    assert.equal((await reserveToken(tokens,{id:'four'})).sha,sha(tokens[1]));
    await updateUsage(snapshot(tokens[1],11,'2026-11-29'));
    await updateUsage(snapshot(tokens[1],99,'2026-11-28'));
    assert.equal((await readLog()).usage.find(x=>x.tokenSha256===sha(tokens[1])).durationHours,11);
    await rm(logPath);
    const reservations=await Promise.all(Array.from({length:4},(_,i)=>reserveToken(tokens,{id:'parallel-'+i})));
    assert.equal(new Set(reservations.map(x=>x.sha)).size,2);
    assert.equal((await readLog()).transcriptions.length,4);
    await rm(logPath);
    const file=join(process.env.TEMP,'fixture.mp3');await writeFile(file,'synthetic audio');
    let completed=false,failUsage=false,submissions=0,usageReads=0;
    globalThis.fetch=async(url,options)=>{
      const u=new URL(url);
      if(u.pathname==='/v2/usage'){
        usageReads++;
        if(failUsage)return Response.json({error:'offline'},{status:503});
        assert.equal(u.searchParams.get('since'),'1970-01-01');
        return Response.json({since:'1970-01-01',until:u.searchParams.get('until'),summary:[{count:completed?1:0,duration_hrs:completed?1.04:0}],details:[]});
      }
      if(options.method==='POST'){submissions++;return Response.json({id:'fixture-job'});}
      if(u.pathname.endsWith('/transcript')){completed=true;return Response.json({job:{duration:3744},results:[]});}
      return Response.json({job:{status:'done'}});
    };
    await transcribe(file);
    let log=await readLog();assert.equal(log.transcriptions[0].status,'success');
    assert.equal(log.transcriptions[0].audioDurationHours,1);
    assert.equal(log.transcriptions[0].model,'enhanced');
    assert.equal(log.usage.find(x=>x.durationSeconds>0).durationHours,1);
    assert.ok(!JSON.stringify(log).includes('private-token'));
    const before=JSON.stringify(log.usage);failUsage=true;
    await transcribe(file);
    log=await readLog();assert.equal(log.transcriptions[1].status,'success');
    assert.equal(JSON.stringify(log.usage),before);
    assert.equal(submissions,2);assert.ok(usageReads>=4);
  `;
  try {
    execFileSync(process.execPath, ["--input-type=module"], {
      input: script, encoding: "utf8", env: { ...process.env, TEMP: directory, TMP: directory, TMPDIR: directory,
        SPEECHMATICS_ENV_FILE: join(directory, "missing.env"), SPEECHMATICS_TOKENS: "account-a:private-token-a,account-b:private-token-b", SPEECHMATICS_MODEL: "enhanced" },
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
