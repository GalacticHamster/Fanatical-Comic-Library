import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as pause} from 'node:timers/promises';
import {createRelease,runtimeZip} from '../scripts/release.mjs';
import {chromePipe,firefoxMarionette,freePort} from './native-protocol.mjs';
import {quotaProduct,quotaBaseline,quotaProtectedFields} from './fixtures/storage-quota.mjs';

const firefox=process.argv.includes('--firefox'),limited=process.argv.includes('--limited');
if(process.argv.slice(2).some(arg=>!['--firefox','--limited'].includes(arg))||firefox&&limited)throw Error('Usage: node tests/storage-quota-runtime.mjs [--firefox | --limited]');
const temporary=await mkdtemp(join(tmpdir(),'fan-storage-quota-')),profile=join(temporary,'profile');
let child,driver,exited;
try{
  const {files:releaseFiles}=await createRelease(undefined,undefined,firefox?'firefox':'chrome'),files=new Map(releaseFiles);
  if(limited){const manifest=JSON.parse(files.get('manifest.json'));manifest.permissions=manifest.permissions.filter(p=>p!=='unlimitedStorage');files.set('manifest.json',Buffer.from(JSON.stringify(manifest)));}
  await mkdir(profile);
  const fixture=`${quotaProduct.toString()}\n${quotaBaseline.toString()}\nconst quotaProtectedFields=${JSON.stringify(quotaProtectedFields)};\n${await readFile(new URL('./storage-quota-checks.js',import.meta.url),'utf8')}`;
  let url,session;
  if(firefox){
    let binary=process.env.FIREFOX_BIN||'C:/Program Files/Mozilla Firefox/firefox.exe';
    if(process.platform==='win32'&&!process.env.FIREFOX_BIN){const location=execFileSync('powershell.exe',['-NoProfile','-Command','(Get-AppxPackage -Name Mozilla.Firefox).InstallLocation'],{windowsHide:true,encoding:'utf8'}).trim();if(location)binary=join(location,'VFS/ProgramFiles/Firefox Package Root/firefox.exe');}
    const port=await freePort(),archive=join(temporary,'FAN.zip');await writeFile(archive,runtimeZip(files));
    await writeFile(join(profile,'user.js'),`user_pref("marionette.port",${port});\nuser_pref("extensions.update.enabled",false);\n`);
    child=spawn(binary,['--headless','--no-remote','--profile',profile,'--marionette','--remote-allow-system-access','about:blank'],{windowsHide:true,env:{...process.env,MOZ_REMOTE_ALLOW_SYSTEM_ACCESS:'1'},stdio:['ignore','pipe','pipe']});exited=new Promise(done=>child.once('exit',done));
    driver=await firefoxMarionette(port);await driver.send('WebDriver:NewSession',{capabilities:{alwaysMatch:{browserName:'firefox'}}});
    await driver.send('Addon:Install',{path:archive,temporary:true});await driver.send('Marionette:SetContext',{value:'chrome'});
    const response=await driver.send('WebDriver:ExecuteScript',{script:'return WebExtensionPolicy.getByID("fanatical-library@galactichamster.com").getURL("src/options.html");',args:[],newSandbox:true});url=response.value??response;
    await driver.send('Marionette:SetContext',{value:'content'});await driver.send('WebDriver:Navigate',{url});
  }else{
    const stage=join(temporary,'runtime');for(const [name,bytes]of files){const path=join(stage,name);await mkdir(resolve(path,'..'),{recursive:true});await writeFile(path,bytes);}
    const binary=process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe';await access(binary);
    child=spawn(binary,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking',`--user-data-dir=${profile}`,'--remote-debugging-pipe','--enable-unsafe-extension-debugging','about:blank'],{windowsHide:true,stdio:['ignore','pipe','pipe','pipe','pipe']});exited=new Promise(done=>child.once('exit',done));driver=chromePipe(child,{timeoutMs:60000});
    const installed=await driver.send('Extensions.loadUnpacked',{path:stage});url=`chrome-extension://${installed.id}/src/options.html`;
    const target=await driver.send('Target.createTarget',{url});session=(await driver.send('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;
  }
  async function evaluate(script){
    if(firefox){const reply=await driver.send('WebDriver:ExecuteAsyncScript',{script:'(async()=>{'+script+'})().then(arguments[arguments.length-1],e=>arguments[arguments.length-1]({error:e.message,stack:e.stack}));',args:[],newSandbox:false});const value=reply.value??reply;assert.equal(value?.error,undefined,JSON.stringify(value));return value;}
    const result=await driver.send('Runtime.evaluate',{expression:'(async()=>{'+script+'})()',awaitPromise:true,returnByValue:true},session);assert.equal(result.exceptionDetails,undefined,JSON.stringify(result.exceptionDetails));return result.result.value;
  }
  async function ready(){for(let n=0;n<150;n++){try{if(await evaluate("return document.querySelector('#library-count')?.textContent.includes('stored locally');"))return;}catch(error){if(!/context|document/i.test(error.message))throw error;}await pause(30);}throw Error('Installed options did not become ready');}
  await ready();const {checks}=await evaluate(fixture+`\nreturn await installedQuotaChecks(${limited});`);
  if(!limited){
    if(firefox)await driver.send('WebDriver:Navigate',{url});else{await driver.send('Page.enable',{},session);await driver.send('Page.reload',{},session);}
    await ready();
    const state=await evaluate("const s=await chrome.storage.local.get(['fanaticalLibraryItems','mediaTypeOverrides','fanaticalProfileArchives']);return {count:s.fanaticalLibraryItems.length,kind:s.fanaticalLibraryItems.find(p=>p.sourceItemId==='quota-product-0').mediaType,override:s.mediaTypeOverrides['quota-product-0'],archives:s.fanaticalProfileArchives.length};");
    assert.deepEqual(state,{count:26001,kind:'comic',override:'comic',archives:1});checks.push('large library, correction and isolated account archive persist after page reload');
  }
  checks.forEach(check=>console.log(`PASS installed ${firefox?'Firefox':'Chrome'}: ${check}`));console.log(`${checks.length} installed ${firefox?'Firefox':'Chrome'} quota checks passed.`);
}finally{
  if(firefox&&driver)try{await driver.send('Marionette:Quit',{flags:['eForceQuit']});}catch{}
  child?.kill();driver?.close?.();if(exited)await exited;
  const target=resolve(temporary);if(!target.startsWith(resolve(tmpdir())+sep)||!target.includes('fan-storage-quota-'))throw Error('Unsafe test cleanup');await rm(target,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
