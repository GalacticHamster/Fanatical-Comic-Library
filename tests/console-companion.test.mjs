import assert from 'node:assert/strict';
import test from 'node:test';
import '../src/shared.js';
const F=globalThis.FanaticalLibrary;

// API-v1 wire fixtures exercise validation AND final classification. The
// adjacent-GL test below additionally proves these are real response shapes.
for(const provider of ['nintendo','playstation','xbox','kindle'])
  for(const ownership of ['owned','claimed','unknown','subscription','borrowed','returned','revoked','expired'])
    test('GL wire contract: '+provider+' '+ownership,async()=>{
      const product={sourceItemId:'synthetic-offer',title:'Synthetic Console Adventure',mediaType:'game'};
      const requests=F.galacticRequestItems([product]);
      const result={requestId:product.sourceItemId,owned:ownership==='owned'||ownership==='claimed',confidence:1,
        matches:[{provider,title:product.title,ownership,relationship:'same-edition',confidence:1,evidence:{source:provider}}],possibleMatches:[],partialMatches:[],coverage:null};
      const lookup=await F.queryGalacticItems(requests,async()=>({ok:true,apiVersion:1,results:[result]}));
      assert.equal(lookup.failed.size,0);assert.deepEqual(requests[0].excludeProviders,['fanatical']);
      assert.equal(F.resolveProduct(product,[],[],()=>lookup.results.get(product.sourceItemId)).state,result.owned?'owned-elsewhere':'possible');
    });

test('unknown provider and ownership values still fail closed',async()=>{
  const request={requestId:'one',title:'Synthetic Adventure',mediaType:'game'};
  for(const changes of [{provider:'unsupported-provider'},{ownership:'wishlist'},{ownership:null}]){
    const match={provider:'xbox',title:request.title,ownership:'owned',relationship:'same-edition',...changes};
    const result=await F.queryGalacticItems([request],async()=>({ok:true,apiVersion:1,results:[{requestId:'one',matches:[match]}]}));
    assert.equal(result.results.size,0);assert(result.failed.has('one'));
  }
});

test('console contract accepts actual adjacent GL projection through query validation and resolver',async t=>{
  let normalize,handle;
  try{
    ({normalizeProviderItem:normalize}=await import('../../GalacticLibrary/src/lib/models.js'));
    ({handleExternalApiRequest:handle}=await import('../../GalacticLibrary/src/lib/external-api.js'));
  }catch(error){if(error.code==='ERR_MODULE_NOT_FOUND'){t.skip('Adjacent Galactic Library checkout unavailable');return;}throw error;}
  for(const [provider,source]of [['nintendo','nintendo-virtual-game-cards'],['playstation','playstation-web-purchased-library'],['xbox','xbox-web-library']]){
    const product={sourceItemId:'synthetic-offer',title:'Synthetic Console Adventure',mediaType:'game'};
    for(const ownership of ['owned','unknown','subscription','returned']){
      const record=normalize({provider,providerItemId:'synthetic-product',title:product.title,mediaType:'game',ownership,metadata:{source}});
      const lookup=await F.queryGalacticItems(F.galacticRequestItems([product]),async request=>handle({providerItems:{[record.id]:record}},request));
      assert.equal(lookup.failed.size,0);
      assert.equal(lookup.results.get(product.sourceItemId).matches[0].evidence.source,source);
      assert.equal(F.resolveProduct(product,[],[],()=>lookup.results.get(product.sourceItemId)).state,ownership==='owned'?'owned-elsewhere':'possible');
    }
  }
});
