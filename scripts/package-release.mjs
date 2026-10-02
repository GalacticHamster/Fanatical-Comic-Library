import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRelease,projectRoot} from './release.mjs';

if(process.argv.slice(2).some(arg=>arg!=='--check'))throw new Error('Usage: node scripts/package-release.mjs [--check]');
const {zip,report}=await createRelease();
if(!process.argv.includes('--check')){
  const destination=resolve(projectRoot,'dist'),name=`FanaticalLibrary-${report.version}.zip`;await mkdir(destination,{recursive:true});
  await writeFile(resolve(destination,name),zip);await writeFile(resolve(destination,name+'.sha256'),`${report.sha256}  ${name}\n`);await writeFile(resolve(destination,'release-files.json'),JSON.stringify(report,null,2)+'\n');
  console.log(`Created dist/${name}`);
}
console.log(`Validated ${report.files.length} runtime files; SHA-256 ${report.sha256}`);
