import {readFile,realpath,stat} from 'node:fs/promises';
import {resolve,relative,dirname,extname,posix,sep,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1;}return (crc^0xffffffff)>>>0;}
function validPath(path){return typeof path==='string'&&path.length<240&&!path.includes('\\')&&!path.startsWith('/')&&path===posix.normalize(path)&&!path.split('/').some(part=>part==='..'||part==='.'||!part)&&/^[a-zA-Z0-9_./-]+$/u.test(path);}
function runtimePath(path){return /^icons\/icon(?:16|32|48|128)\.png$/u.test(path)||['LICENSE','NOTICE','manifest.json'].includes(path)||path.startsWith('src/')&&['.js','.mjs','.html','.css','.png'].includes(extname(path));}
function dependency(files,owner,path,root=false){
  if(path==='')return;
  if(root){if(!validPath(path)||!files.has(path))throw new Error(`Missing ${owner==='manifest.json'?'manifest runtime':'runtime'} dependency: ${owner} -> ${path}`);return;}
  if(!path||path.startsWith('#')||/^(?:https?:|data:)/u.test(path))return;
  const target=root?path:posix.normalize(posix.join(posix.dirname(owner),path));
  if(!validPath(target)||!files.has(target))throw new Error(`Missing runtime dependency: ${owner} -> ${path}`);
}
export function validateRuntime(files){
  for(const required of ['manifest.json','src/options.html','src/popup.html'])if(!files.has(required))throw new Error(`Missing required runtime file: ${required}`);
  const manifest=JSON.parse(files.get('manifest.json'));
  if(manifest.manifest_version!==3||!/^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,3}$/u.test(manifest.version)||manifest.version.split('.').some(part=>Number(part)>65535))throw new Error('Invalid extension manifest/version.');
  for(const path of [manifest.background?.service_worker,...(manifest.background?.scripts??[]),manifest.background?.page,manifest.options_page,manifest.action?.default_popup,...Object.values(manifest.icons??{}),...Object.values(manifest.action?.default_icon??{})])if(path)dependency(files,'manifest.json',path,true);
  for(const group of [manifest.icons,manifest.action?.default_icon]){
    if(!group||typeof group!=='object')continue;
    for(const [size,path]of Object.entries(group)){
      const bytes=files.get(path),dimension=Number(size);
      if(!Number.isInteger(dimension)||dimension<1||!bytes||bytes.length<24||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.subarray(12,16).toString()!=='IHDR'||bytes.readUInt32BE(16)!==dimension||bytes.readUInt32BE(20)!==dimension)throw Error(`Invalid manifest icon PNG or dimensions: ${path}`);
    }
  }
  for(const entry of manifest.content_scripts??[])for(const path of [...(entry.js??[]),...(entry.css??[])])dependency(files,'manifest.json',path,true);
  for(const entry of manifest.web_accessible_resources??[])for(const path of entry.resources??[])dependency(files,'manifest.json',path,true);
  for(const [path,bytes]of files){
    const source=bytes.toString('utf8');
    if(['.js','.mjs'].includes(extname(path))){
      for(const match of source.matchAll(/\b(?:import|export)\s+(?:[^'";]+?\s+from\s*)?['"]([^'"]+)['"]/gu)){
        if(!match[1].startsWith('.'))throw new Error(`Runtime modules must use local imports: ${path}`);dependency(files,path,match[1]);
      }
      const dynamic=[...source.matchAll(/(?<![.\w])import\s*\(/gu)],literals=[...source.matchAll(/(?<![.\w])import\s*\(\s*['"]([^'"]+)['"]\s*\)/gu)];
      if(dynamic.length!==literals.length)throw new Error(`Unvalidated dynamic import: ${path}`);for(const match of literals)dependency(files,path,match[1]);
      for(const match of source.matchAll(/\bgetURL\(\s*['"]([^'"]*)['"]\s*\)/gu))dependency(files,path,match[1],true);
      for(const match of source.matchAll(/new\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/gu))dependency(files,path,match[1]);
    }else if(path.endsWith('.html')){
      for(const match of source.matchAll(/\b(?:src|href)\s*=\s*['"]([^'"]+)['"]/gu))dependency(files,path,match[1]);
      if(/<script\b[^>]*\bsrc\s*=\s*['"]https?:/iu.test(source))throw new Error(`Remote script in runtime page: ${path}`);
    }else if(path.endsWith('.css'))for(const match of source.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/gu))dependency(files,path,match[1]);
  }
  return manifest;
}
/** Stored ZIP: fixed order, UTF-8 names, DOS epoch, no host paths or build time. */
export function runtimeZip(files){
  if(files.size>1000)throw new Error('Runtime file count exceeds package bound.');
  const locals=[],central=[];let offset=0;
  for(const [path,bytes]of [...files].sort(([a],[b])=>a<b?-1:a>b?1:0)){
    const name=Buffer.from(path),crc=crc32(bytes),header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(33,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(bytes.length,18);header.writeUInt32LE(bytes.length,22);header.writeUInt16LE(name.length,26);
    locals.push(header,name,bytes);
    const directory=Buffer.alloc(46);directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt16LE(0x800,8);directory.writeUInt16LE(33,14);directory.writeUInt32LE(crc,16);directory.writeUInt32LE(bytes.length,20);directory.writeUInt32LE(bytes.length,24);directory.writeUInt16LE(name.length,28);directory.writeUInt32LE(offset,42);central.push(directory,name);offset+=header.length+name.length+bytes.length;
  }
  const end=Buffer.alloc(22),directory=Buffer.concat(central);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.size,8);end.writeUInt16LE(files.size,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,directory,end]);
}
/** Validate the actual archive before serving its runtime in browser fixtures. */
export function readRuntimeZip(zip){
  if(zip.length<22||zip.length>50*1024*1024)throw new Error('Invalid runtime archive size.');
  const end=zip.length-22;if(zip.readUInt32LE(end)!==0x06054b50||zip.readUInt16LE(end+20)!==0||zip.readUInt16LE(end+4)||zip.readUInt16LE(end+6))throw new Error('Invalid ZIP end record.');
  const count=zip.readUInt16LE(end+10),start=zip.readUInt32LE(end+16),size=zip.readUInt32LE(end+12);if(count>1000||zip.readUInt16LE(end+8)!==count||start+size!==end)throw new Error('Invalid ZIP directory bounds.');
  const files=new Map();let cursor=start,localCursor=0;
  for(let index=0;index<count;index++){
    if(cursor+46>end||zip.readUInt32LE(cursor)!==0x02014b50)throw new Error('Invalid ZIP directory entry.');
    const length=zip.readUInt32LE(cursor+24),nameLength=zip.readUInt16LE(cursor+28),extra=zip.readUInt16LE(cursor+30),comment=zip.readUInt16LE(cursor+32),offset=zip.readUInt32LE(cursor+42);
    if(cursor+46+nameLength>end||extra||comment||zip.readUInt16LE(cursor+10)||zip.readUInt16LE(cursor+8)!==0x800||zip.readUInt16LE(cursor+12)||zip.readUInt16LE(cursor+14)!==33||zip.readUInt32LE(cursor+20)!==length||offset!==localCursor||offset+30>start)throw new Error('Invalid deterministic ZIP entry.');
    const name=zip.subarray(cursor+46,cursor+46+nameLength).toString('utf8');if(!validPath(name)||!runtimePath(name)||files.has(name))throw new Error('Invalid ZIP runtime path.');
    if(zip.readUInt32LE(offset)!==0x04034b50||zip.readUInt16LE(offset+6)!==0x800||zip.readUInt16LE(offset+8)||zip.readUInt16LE(offset+10)||zip.readUInt16LE(offset+12)!==33||zip.readUInt16LE(offset+26)!==nameLength||zip.readUInt16LE(offset+28)||zip.readUInt32LE(offset+18)!==length||zip.readUInt32LE(offset+22)!==length||zip.subarray(offset+30,offset+30+nameLength).toString('utf8')!==name)throw new Error('ZIP local header disagrees.');
    localCursor=offset+30+nameLength+length;if(localCursor>start)throw new Error('Invalid ZIP payload bounds.');const bytes=zip.subarray(offset+30+nameLength,localCursor);
    if(crc32(bytes)!==zip.readUInt32LE(cursor+16)||crc32(bytes)!==zip.readUInt32LE(offset+14))throw new Error('ZIP checksum mismatch.');files.set(name,bytes);cursor+=46+nameLength;
  }
  if(cursor!==end||localCursor!==start)throw new Error('ZIP contains unlisted payloads.');validateRuntime(files);return files;
}
export async function createRelease(root=projectRoot,allowlist,target="chrome"){
  if(!["chrome","firefox"].includes(target))throw Error("Unknown release target.");
  const base=await realpath(root),paths=allowlist??JSON.parse(await readFile(resolve(base,'scripts/runtime-files.json'),'utf8'));
  if(!Array.isArray(paths)||!paths.length||paths.length>1000||paths.some(path=>!validPath(path)||!runtimePath(path))||new Set(paths).size!==paths.length)throw new Error('Invalid explicit runtime allowlist.');
  const files=new Map();let total=0;
  for(const path of [...paths].sort()){
    const target=await realpath(resolve(base,path)),location=relative(base,target);if(isAbsolute(location)||location==='..'||location.startsWith('..'+sep)||resolve(base,location)!==target)throw new Error(`Runtime file leaves project: ${path}`);
    if(!(await stat(target)).isFile())throw new Error(`Runtime entry is not a file: ${path}`);let bytes=await readFile(target);if(bytes.length>5*1024*1024)throw new Error(`Runtime file exceeds bound: ${path}`);
    if(['.js','.mjs','.css','.html','.json'].includes(extname(path))||['LICENSE','NOTICE'].includes(path))bytes=Buffer.from(bytes.toString('utf8').replace(/\r\n?/gu,'\n'));
    files.set(path,bytes);total+=bytes.length;if(total>40*1024*1024)throw new Error('Runtime package exceeds bound.');
  }
  if(target==='firefox'){const overlay=JSON.parse(await readFile(resolve(base,'manifests/firefox.json'),'utf8')),manifest={...JSON.parse(files.get('manifest.json')),...overlay};delete manifest.minimum_chrome_version;files.set('manifest.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n'));}
  const manifest=validateRuntime(files),zip=runtimeZip(files),extracted=readRuntimeZip(zip);if(extracted.size!==files.size)throw new Error('Archive file count mismatch.');
  const report={name:manifest.name,version:manifest.version,sha256:hash(zip),files:[...files].map(([path,bytes])=>({path,bytes:bytes.length,sha256:hash(bytes)}))};return {zip,files:extracted,report};
}
