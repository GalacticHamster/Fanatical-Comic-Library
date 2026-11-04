import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,writeFile,rm,utimes,symlink} from 'node:fs/promises';
import {join,dirname,resolve,sep,extname} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createRelease,readRuntimeZip,validateRuntime} from '../scripts/release.mjs';

test('extension and toolbar icons are genuine size-matched local artwork in both artifacts',async()=>{
 for(const target of ['chrome','firefox']){
  const release=await createRelease(undefined,undefined,target),manifest=JSON.parse(release.files.get('manifest.json'));
  for(const group of [manifest.icons,manifest.action.default_icon]){assert.deepEqual(Object.keys(group),['16','32','48','128']);for(const [size,path]of Object.entries(group)){assert.equal(path,`icons/icon${size}.png`);const bytes=release.files.get(path);assert.equal(bytes.readUInt32BE(16),Number(size));assert.equal(bytes.readUInt32BE(20),Number(size));}}
  const broken=new Map(release.files);broken.set('icons/icon32.png',Buffer.from('not an icon'));assert.throws(()=>validateRuntime(broken),/Invalid manifest icon/);
  const mismatched=new Map(release.files);mismatched.set('icons/icon32.png',release.files.get('icons/icon48.png'));assert.throws(()=>validateRuntime(mismatched),/Invalid manifest icon/);
  const missing=new Map(release.files);missing.delete('icons/icon16.png');assert.throws(()=>validateRuntime(missing),/Missing manifest runtime/);
  assert(!release.files.has('icons/icon256.png')&&!release.files.has('icons/icon512-source-extract.png'));
 }
});

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
    await assert.rejects(createRelease(root,[...first.files.keys()].filter(path=>path!=='LICENSE')),/Missing required runtime file: LICENSE/);
    await assert.rejects(createRelease(root,[...first.files.keys()].filter(path=>path!=='NOTICE')),/Missing required runtime file: NOTICE/);
    const noLicense=new Map(first.files);noLicense.delete('LICENSE');assert.throws(()=>validateRuntime(noLicense),/Missing required runtime file: LICENSE/);
    const noNotice=new Map(first.files);noNotice.delete('NOTICE');assert.throws(()=>validateRuntime(noNotice),/Missing required runtime file: NOTICE/);
    const broken=Buffer.from(first.zip);broken[50]^=1;assert.throws(()=>readRuntimeZip(broken),/ZIP/);
    for(const path of first.files.keys())if(['.js','.mjs'].includes(extname(path)))execFileSync(process.execPath,['--check',join(root,path)],{windowsHide:true,stdio:'pipe'});
  }finally{await cleanup(root);}
});
test('runtime allowlist rejects a junction that leaves the project',async()=>{
  const root=await mkdtemp(join(tmpdir(),'fan-release-test-')),outside=await mkdtemp(join(tmpdir(),'fan-release-test-'));try{await mkdir(join(root,'src'));await writeFile(join(outside,'private.js'),'PRIVATE');await symlink(outside,join(root,'src','external'),process.platform==='win32'?'junction':'dir');await assert.rejects(createRelease(root,['src/external/private.js']),/leaves project/);}finally{await cleanup(root);await cleanup(outside);}
});

test('Firefox package uses a stable ID and module event page with identical validated runtime',async()=>{const chrome=await createRelease(),first=await createRelease(undefined,undefined,'firefox'),second=await createRelease(undefined,undefined,'firefox');assert.deepEqual(first.zip,second.zip);assert.deepEqual([...first.files.keys()],[...chrome.files.keys()]);const manifest=JSON.parse(first.files.get('manifest.json'));assert.equal(manifest.background.service_worker,undefined);assert.deepEqual(manifest.background.scripts,['src/service-worker.js']);assert.equal(manifest.background.type,'module');assert.equal(manifest.browser_specific_settings.gecko.id,'fanatical-library@galactichamster.com');for(const [name,bytes]of first.files)if(name!=='manifest.json')assert.deepEqual(bytes,chrome.files.get(name));const missing=new Map(first.files);missing.delete('src/service-worker.js');assert.throws(()=>validateRuntime(missing),/Missing manifest runtime dependency/);await assert.rejects(createRelease(undefined,undefined,'invalid'),/Unknown release target/);});

test('both generated artifacts retain store identity configuration with large-library storage permission and no manifest wildcard',async()=>{for(const target of ['chrome','firefox']){const release=await createRelease(undefined,undefined,target),manifest=JSON.parse(release.files.get('manifest.json')),shared=release.files.get('src/shared.js').toString();for(const id of ['bjjpfofmcmiipeghcbhdfjedpldmkcii','pdknncacndkicpogbebdfanniibnnpic','ieoobffekgbfjfoiheejkfihneooiadb'])assert(shared.includes(id));assert.equal(manifest.externally_connectable,undefined);assert.equal(manifest.key,undefined);assert.deepEqual(manifest.permissions,['storage','unlimitedStorage','scripting','alarms']);assert.deepEqual(manifest.host_permissions,['https://www.fanatical.com/*']);}});

test('both packaged extension pages explicitly reuse the approved 16px manifest favicon',async()=>{
 for(const target of ['chrome','firefox']){
  const release=await createRelease(undefined,undefined,target),files=readRuntimeZip(release.zip),manifest=JSON.parse(files.get('manifest.json'));
  for(const page of [manifest.options_page,manifest.action.default_popup]){
   const links=[...files.get(page).toString().matchAll(/<link\b[^>]*rel="icon"[^>]*>/gu)];assert.equal(links.length,1);
   const link=links[0][0],href=link.match(/href="([^"]+)"/u)[1],asset=new URL(href,'https://package.invalid/'+page).pathname.slice(1);
   assert.equal(asset,manifest.icons['16']);assert(link.includes('image/png')&&link.includes('16x16'));assert(files.has(asset));
   const bytes=files.get(asset);assert.equal(bytes.readUInt32BE(16),16);assert.equal(bytes.readUInt32BE(20),16);
  }
 }
});
