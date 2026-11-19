import test from 'node:test';import assert from 'node:assert/strict';
import {createTitleCatalog,createTitleCatalogCsv} from '../src/library-data.mjs';

// Same columns and meanings as Humble Library's CSV catalog; one row per merged Library title.
const header='"Title","Media type","Purchase status","First purchased","Last purchased","Purchase count","Purchase count confidence","Source","Bundle / purchase name","Purchase dates"';
const rows=csv=>csv.replace(/^﻿/u,'').trim().split('\r\n');
const zoned=(zone,run)=>{const previous=process.env.TZ;process.env.TZ=zone;try{return run();}finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}};
const ref=c=>c.repeat(64);
const origin=(purchaseRef,title,date,quantity=1)=>({...(purchaseRef?{purchaseRef}:{}),bundle:{sourceItemId:title.toLowerCase().replace(/\W+/gu,'-'),title},purchaseDate:date,quantity});
const game=(title,origins,extra={})=>({source:'fanatical',sourceItemId:'product-'+title.length,title,mediaType:'game',bundle:origins[0]?.bundle??{sourceItemId:'b',title:'B'},purchaseDate:origins[0]?.purchaseDate??null,purchaseOrigins:origins,...extra});

test('separate orders give first and last purchase dates, a numeric count and every purchase, earliest first',()=>{
 const csv=zoned('UTC',()=>createTitleCatalogCsv([game('Twice Bought',[origin(ref('b'),'Later Bundle','2025-06-01T12:00:00Z'),origin(ref('a'),'Early Bundle','2022-03-01T12:00:00Z')])]));
 assert.deepEqual(rows(csv),[header,'"Twice Bought","game","Purchased","2022-03-01","2025-06-01","2","Exact","Fanatical purchase","Early Bundle; Later Bundle","2022-03-01; 2025-06-01"']);
 assert(csv.startsWith('﻿')&&csv.endsWith('\r\n'));
});

test('copies in one order are listed separately, unknown dates stay unknown and are listed last',()=>{
 const csv=zoned('UTC',()=>createTitleCatalogCsv([game('Copies',[origin(ref('a'),'Gift Pack','2024-02-02T10:00:00Z',2),origin(ref('b'),'Undated Bundle',null)])]));
 assert.equal(rows(csv)[1],'"Copies","game","Purchased","2024-02-02","2024-02-02","3","Exact","Fanatical purchase","Gift Pack; Gift Pack; Undated Bundle","2024-02-02; 2024-02-02; unknown"');
});

test('dates are calendar days in the browser time zone',()=>{
 const csv=zoned('America/New_York',()=>createTitleCatalogCsv([game('Late Night',[origin(ref('a'),'Night Bundle','2026-11-17T03:45:00Z')])]));
 assert.equal(rows(csv)[1],'"Late Night","game","Purchased","2026-11-16","2026-11-16","1","Exact","Fanatical purchase","Night Bundle","2026-11-16"');
});

test('a total that may count the same order twice is a lower bound; a manual title is not a purchase',()=>{
 const csv=zoned('UTC',()=>createTitleCatalogCsv([game('Maybe Twice',[origin(ref('a'),'Same Bundle','2023-01-01T12:00:00Z'),origin(null,'Same Bundle',null)]),{source:'fanatical',sourceItemId:'product-manual',title:'Manual Title',mediaType:'book'}]));
 const lines=rows(csv);assert.equal(lines.length,3);
 assert(lines.includes('"Manual Title","book","Not recorded as a purchase","","","0","","Added manually","",""'),lines.join('\n'));
 assert(lines.includes('"Maybe Twice","game","Purchased","2023-01-01","2023-01-01","1","At least","Fanatical purchase","Same Bundle","2023-01-01"'),lines.join('\n'));
});

test('comics keep their Library classification and cells cannot start a spreadsheet formula',()=>{
 const comic=game('=HYPERLINK("x")',[origin(ref('a'),'+Comic Bundle','2021-05-05T12:00:00Z')],{mediaType:'book',formats:['cbz']});
 const [, row]=rows(zoned('UTC',()=>createTitleCatalogCsv([comic])));
 assert.equal(row,'"\'=HYPERLINK(""x"")","comic","Purchased","2021-05-05","2021-05-05","1","Exact","Fanatical purchase","\'+Comic Bundle","2021-05-05"');
});

test('the CSV and JSON catalogs list the same rows, and exporting never changes saved records',()=>{
 const items=[game('Alpha',[origin(ref('a'),'A','2020-01-01T12:00:00Z')]),game('Beta',[origin(ref('b'),'B','2020-02-02T12:00:00Z')])],before=structuredClone(items);
 const csv=createTitleCatalogCsv(items),json=createTitleCatalog(items);
 assert.deepEqual(rows(csv).slice(1).map(r=>JSON.parse('['+r+']')[0]),json.items.map(i=>i.title));
 assert.deepEqual(items,before);
 assert.deepEqual(rows(createTitleCatalogCsv([])),[header]);
});
