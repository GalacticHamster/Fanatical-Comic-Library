import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,writeFile,rm,utimes,symlink} from 'node:fs/promises';
import {join,dirname,resolve,sep,extname} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createRelease,readRuntimeZip,validateRuntime} from '../scripts/release.mjs';

async function cleanup(directory){const target=resolve(directory),base=resolve(tmpdir());if(!target.startsWith(base+sep)||!target.slice(base.length+1).startsWith('fan-release-test-'))throw Error('Unsafe cleanup.');await rm(target,{recursive:true,force:true});}
test('shipped runtime ZIP is deterministic, dependency-complete, syntax-valid and excludes personal data',async()=>{
  const first=await createRelease(),second=await createRelease();assert.deepEqual(first.zip,second.zip);assert.deepEqual(first.report,second.report);assert(first.files.has('src/order-importer.mjs'));assert(!first.files.has('src/projection.mjs'));assert(![...first.files.keys()].some(path=>/recon|backup|README|tests|docs|scripts|package.json/i.test(path)));
  const root=await mkdtemp(join(tmpdir(),'fan-release-test-'));try{
    for(const [path,bytes]of first.files){const target=join(root,path);await mkdir(dirname(target),{recursive:true});await writeFile(target,['.js','.mjs','.css','.json','.html'].includes(extname(path))?bytes.toString().replaceAll('\n','\r\n'):bytes);await utimes(target,new Date('2001-01-01'),new Date('2026-10-01'));}
    await writeFile(join(root,'package.json'),JSON.stringify({type:'module'}));await writeFile(join(root,'recon.txt'),'SYNTHETIC PRIVATE');await writeFile(join(root,'fanatical-library-export.json'),'SYNTHETIC PRIVATE');
    assert.deepEqual((await createRelease(root,[...first.files.keys()])).zip,first.zip);assert(!first.zip.includes(Buffer.from('SYNTHETIC PRIVATE')));
    for(const path of ['../private.js','recon.txt','fanatical-library-export.json'])await assert.rejects(createRelease(root,[...first.files.keys(),path]),/allowlist/);
    await assert.rejects(createRelease(root,[...first.files.keys()].filter(path=>path!=='src/order-importer.mjs')),/Missing runtime dependency/);
    await assert.rejects(createRelease(root,[...first.files.keys()].filter(path=>path!=='src/content.js')),/Missing manifest runtime/);
    const broken=Buffer.from(first.zip);broken[50]^=1;assert.throws(()=>readRuntimeZip(broken),/ZIP/);
    for(const path of first.files.keys())if(['.js','.mjs'].includes(extname(path)))execFileSync(process.execPath,['--check',join(root,path)],{windowsHide:true,stdio:'pipe'});
  }finally{await cleanup(root);}
});
test('runtime allowlist rejects a junction that leaves the project',async()=>{
  const root=await mkdtemp(join(tmpdir(),'fan-release-test-')),outside=await mkdtemp(join(tmpdir(),'fan-release-test-'));try{await mkdir(join(root,'src'));await writeFile(join(outside,'private.js'),'PRIVATE');await symlink(outside,join(root,'src','external'),process.platform==='win32'?'junction':'dir');await assert.rejects(createRelease(root,['src/external/private.js']),/leaves project/);}finally{await cleanup(root);await cleanup(outside);}
});

test('Firefox package uses a stable ID and module event page with identical validated runtime',async()=>{const chrome=await createRelease(),first=await createRelease(undefined,undefined,'firefox'),second=await createRelease(undefined,undefined,'firefox');assert.deepEqual(first.zip,second.zip);assert.deepEqual([...first.files.keys()],[...chrome.files.keys()]);const manifest=JSON.parse(first.files.get('manifest.json'));assert.equal(manifest.background.service_worker,undefined);assert.deepEqual(manifest.background.scripts,['src/service-worker.js']);assert.equal(manifest.background.type,'module');assert.equal(manifest.browser_specific_settings.gecko.id,'fanatical-library@galactichamster.com');for(const [name,bytes]of first.files)if(name!=='manifest.json')assert.deepEqual(bytes,chrome.files.get(name));const missing=new Map(first.files);missing.delete('src/service-worker.js');assert.throws(()=>validateRuntime(missing),/Missing manifest runtime dependency/);await assert.rejects(createRelease(undefined,undefined,'invalid'),/Unknown release target/);});
