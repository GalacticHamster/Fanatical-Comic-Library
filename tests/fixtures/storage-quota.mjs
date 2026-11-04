// Generated synthetic purchase metadata; no external data or oversized fields.
export function quotaProduct(i) {
  return {
    source:'fanatical',sourceItemId:`quota-product-${i}`,mediaType:'book',
    title:`The Illustrated Archive of Imaginary Worlds: Explorations in Science, Culture and Storytelling, Volume ${i} - Collected Essays and Reference Materials`,
    slug:`illustrated-archive-imaginary-worlds-collected-essays-volume-${i}`,
    authors:['Alexandra Synthetic Author','Benjamin Fictional Contributor','Catherine Example Illustrator'],
    language:'en',edition:'Revised and expanded illustrated digital reference edition',
    series:'The Illustrated Archive of Imaginary Worlds and Collected Reference Materials',volume:String(i),
    drm:['DRM Free'],platforms:['Windows','Mac','Linux'],formats:['.epub','.pdf'],
    bundle:{sourceItemId:`quota-bundle-${Math.floor(i/25)}`,title:'The Complete Imaginary Worlds Reference Collection: Illustrated Essays, Creative Guides, Historical Studies and Companion Volumes - Synthetic Bundle',slug:`imaginary-worlds-reference-collection-${Math.floor(i/25)}`},
    purchaseDate:'2026-01-15T12:00:00.000Z',
    purchaseOrigins:[{purchaseRef:(Math.floor(i/25)+1).toString(16).padStart(64,'0'),
      bundle:{sourceItemId:`quota-bundle-${Math.floor(i/25)}`,title:'The Complete Imaginary Worlds Reference Collection: Illustrated Essays, Creative Guides, Historical Studies and Companion Volumes - Synthetic Bundle',slug:`imaginary-worlds-reference-collection-${Math.floor(i/25)}`},
      purchaseDate:'2026-01-15T12:00:00.000Z',quantity:1}]
  };
}

export function quotaBaseline() {
  const old={source:'fanatical',sourceItemId:'quota-previous-product',title:'Previous purchase retained',mediaType:'book',purchaseDate:null,bundle:{sourceItemId:'quota-previous-bundle',title:'Previous bundle'}};
  return {
    fanaticalAccountId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',fanaticalProfileLabel:'fixture',
    fanaticalLibraryItems:[quotaProduct(0)],fanaticalScannedOrderFingerprints:[],
    fanaticalImportSummary:{scanMode:'full',importedAt:'2026-01-15T12:00:00.000Z'},
    fanaticalHistoricalItems:[{profileLabel:'fixture',missingSince:'2026-02-01T12:00:00.000Z',item:old}],
    fanaticalProfileArchives:[{accountId:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',profileLabel:'Other account',items:[old],historicalItems:[],archivedAt:'2026-02-01T12:00:00.000Z',localScanState:{fingerprints:['f'.repeat(64)],summary:{scanMode:'full'},attempt:null}}],
    fanaticalWishlistItems:[],mediaTypeOverrides:{'quota-product-0':'comic'},rejectedPurchaseItems:[]
  };
}

export const quotaProtectedFields = ['fanaticalLibraryItems','fanaticalHistoricalItems','fanaticalProfileArchives','fanaticalAccountId','fanaticalProfileLabel','fanaticalScannedOrderFingerprints','fanaticalImportSummary','fanaticalWishlistItems','mediaTypeOverrides','rejectedPurchaseItems'];
