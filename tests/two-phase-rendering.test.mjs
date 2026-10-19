import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

class MockElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = {};
    this.style = {
      _styles: new Map(),
      setProperty(k, v) { this._styles.set(k, v); },
      removeProperty(k) { this._styles.delete(k); },
      getPropertyValue(k) { return this._styles.get(k) || ''; },
      getPropertyPriority() { return ''; }
    };
    this.open = false;
    this.disabled = false;
    this.checked = false;
    this.value = '';
    this.type = '';
    this.title = '';
    this.href = '';
    this.download = '';
    this.scrollTop = 0;
    this._classes = new Set();
    this._textContent = '';
  }

  get id() {
    return this.attributes.get('id') ?? '';
  }

  set id(val) {
    this.setAttribute('id', val);
  }

  get className() {
    return [...this._classes].join(' ');
  }

  set className(val) {
    this._classes.clear();
    if (val) {
      val.split(/\s+/).filter(Boolean).forEach(c => this._classes.add(c));
    }
  }

  get classList() {
    return {
      add: (...cls) => cls.forEach(c => this._classes.add(c)),
      remove: (...cls) => cls.forEach(c => this._classes.delete(c)),
      contains: (c) => this._classes.has(c),
      toggle: (c, force) => {
        if (force === true) this._classes.add(c);
        else if (force === false) this._classes.delete(c);
        else if (this._classes.has(c)) this._classes.delete(c);
        else this._classes.add(c);
      }
    };
  }

  get textContent() {
    if (this.children.length === 0) return this._textContent;
    return this.children.map(c => typeof c === 'string' ? c : c.textContent).join('');
  }

  set textContent(val) {
    this.children = [];
    this._textContent = String(val);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(type, handler) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(handler);
  }

  dispatchEvent(event) {
    const list = this.listeners[event.type] || [];
    for (const handler of list) {
      handler.call(this, event);
    }
    return true;
  }

  focus() {}
  blur() {}

  contains(other) {
    let curr = other;
    while (curr) {
      if (curr === this) return true;
      curr = curr.parentElement;
    }
    return false;
  }

  closest(selector) {
    let curr = this;
    while (curr) {
      if (curr instanceof MockElement && curr._matchesSingle(curr, selector)) return curr;
      curr = curr.parentElement;
    }
    return null;
  }

  append(...nodes) {
    for (const node of nodes) {
      if (typeof node === 'string') {
        const textNode = new MockElement('#text');
        textNode._textContent = node;
        textNode.parentElement = this;
        this.children.push(textNode);
      } else if (node instanceof MockElement) {
        if (node.parentElement) {
          node.remove();
        }
        node.parentElement = this;
        this.children.push(node);
      }
    }
  }

  prepend(...nodes) {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      if (typeof node === 'string') {
        const textNode = new MockElement('#text');
        textNode._textContent = node;
        textNode.parentElement = this;
        this.children.unshift(textNode);
      } else if (node instanceof MockElement) {
        if (node.parentElement) {
          node.remove();
        }
        node.parentElement = this;
        this.children.unshift(node);
      }
    }
  }

  replaceChildren(...nodes) {
    for (const child of this.children) {
      if (child instanceof MockElement) child.parentElement = null;
    }
    this.children = [];
    this._textContent = '';
    this.append(...nodes);
  }

  remove() {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx !== -1) this.parentElement.children.splice(idx, 1);
      this.parentElement = null;
    }
  }

  get isConnected() {
    let curr = this;
    while (curr) {
      if (curr.tagName === 'BODY' || curr.tagName === 'HTML') return true;
      curr = curr.parentElement;
    }
    return false;
  }

  replaceWith(newEl) {
    if (!this.parentElement) return;
    const idx = this.parentElement.children.indexOf(this);
    if (idx !== -1) {
      if (newEl.parentElement) newEl.remove();
      newEl.parentElement = this.parentElement;
      this.parentElement.children.splice(idx, 1, newEl);
      this.parentElement = null;
    }
  }

  after(newEl) {
    if (!this.parentElement) return;
    const idx = this.parentElement.children.indexOf(this);
    if (idx !== -1) {
      if (newEl.parentElement) newEl.remove();
      newEl.parentElement = this.parentElement;
      this.parentElement.children.splice(idx + 1, 0, newEl);
    }
  }

  before(newEl) {
    if (!this.parentElement) return;
    const idx = this.parentElement.children.indexOf(this);
    if (idx !== -1) {
      if (newEl.parentElement) newEl.remove();
      newEl.parentElement = this.parentElement;
      this.parentElement.children.splice(idx, 0, newEl);
    }
  }

  matches(selector) {
    return this._matchesSingle(this, selector);
  }

  querySelector(selector) {
    for (const child of this.children) {
      if (!(child instanceof MockElement)) continue;
      if (this._matchesComplex(child, selector)) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  querySelectorAll(selector) {
    const results = [];
    for (const child of this.children) {
      if (!(child instanceof MockElement)) continue;
      if (this._matchesComplex(child, selector)) results.push(child);
      results.push(...child.querySelectorAll(selector));
    }
    return results;
  }

  _matchesComplex(el, selector) {
    if (selector.includes('+')) {
      const parts = selector.split('+').map(s => s.trim());
      if (!this._matchesSingle(el, parts[parts.length - 1])) return false;
      const parent = el.parentElement;
      if (!parent) return false;
      const idx = parent.children.indexOf(el);
      if (idx <= 0) return false;
      const prev = parent.children[idx - 1];
      return prev instanceof MockElement && this._matchesSingle(prev, parts[0]);
    }
    const parts = selector.split(/\s+/);
    if (parts.length === 1) {
      return this._matchesSingle(el, parts[0]);
    }
    let current = el;
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i];
      if (!current || !this._matchesSingle(current, part)) return false;
      current = current.parentElement;
    }
    return true;
  }

  _matchesSingle(el, sel) {
    let s = sel;
    const attrMatch = s.match(/\[([^=\]]+)(?:="([^"]*)")?\]/);
    if (attrMatch) {
      const attrName = attrMatch[1];
      const attrVal = attrMatch[2];
      if (attrName.startsWith('data-')) {
        const key = attrName.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        if (attrVal !== undefined) {
          if (el.dataset[key] !== attrVal) return false;
        } else if (!(key in el.dataset)) {
          return false;
        }
      } else {
        if (attrVal !== undefined) {
          if (el.getAttribute(attrName) !== attrVal) return false;
        } else if (!el.attributes.has(attrName)) {
          return false;
        }
      }
      s = s.replace(attrMatch[0], '');
    }
    if (!s) return true;
    if (s.startsWith('#')) return el.id === s.slice(1);
    if (s.startsWith('.')) {
      const classes = s.split('.').filter(Boolean);
      return classes.every(c => el._classes.has(c));
    }
    if (s.includes('.')) {
      const [tag, ...classes] = s.split('.');
      if (tag && el.tagName.toLowerCase() !== tag.toLowerCase()) return false;
      return classes.every(c => el._classes.has(c));
    }
    return el.tagName.toLowerCase() === s.toLowerCase();
  }
}

function createHarness() {
  const root = new MockElement('body');
  const docElement = new MockElement('html');
  docElement.append(root);

  class MockMutationObserver {
    constructor(callback) { this.callback = callback; }
    observe() {}
    disconnect() {}
  }

  class MockEvent {
    constructor(type) { this.type = type; }
  }

  const doc = {
    title: '',
    documentElement: docElement,
    body: root,
    activeElement: null,
    createElement: (tag) => new MockElement(tag),
    createTextNode: (text) => {
      const el = new MockElement('#text');
      el._textContent = String(text);
      return el;
    },
    querySelector: (sel) => docElement.querySelector(sel),
    querySelectorAll: (sel) => docElement.querySelectorAll(sel),
    addEventListener: () => {}
  };

  const context = {
    Blob, URL, clearTimeout, console, document: doc,
    Event: MockEvent,
    MutationObserver: MockMutationObserver,
    location: {
      href: 'https://www.fanatical.com/en/bundle/test-bundle',
      pathname: '/en/bundle/test-bundle'
    },
    performance: { now: () => 100 },
    Promise, setTimeout,
    chrome: {
      runtime: {
        id: 'mock-ext-id',
        sendMessage: async () => ({ ok: true, apiVersion: 1, results: [] })
      },
      storage: {
        local: {
          get: async (d) => ({
            fanaticalLibraryItems: [],
            fanaticalHistoricalItems: [],
            galacticLibraryExtensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            fanaticalSummaryPreferences: { minimized: false, position: 'bottom-right' },
            ...d
          }),
          set: async () => {}
        },
        onChanged: {
          addListener: () => {}
        }
      }
    }
  };
  context.globalThis = context;
  vm.createContext(context);

  const rootUrl = new URL('../', import.meta.url);
  for (const file of ['src/shared.js', 'src/planning.js', 'src/planning-ui.js', 'src/content.js']) {
    vm.runInContext(fs.readFileSync(new URL(file, rootUrl), 'utf8'), context, { filename: file });
  }

  return { context, doc, root };
}

function createTestBundle() {
  return {
    sourceItemId: 'bundle-test',
    kind: 'standard',
    title: 'Test Bundle',
    bundle: { sourceItemId: 'bundle-test', title: 'Test Bundle' },
    groups: [
      {
        price: { USD: 500 },
        products: [
          { sourceItemId: 'prod-1', title: 'Game 1', kind: 'game', mediaType: 'game', availability: { regionAvailable: true, soldOut: false } },
          { sourceItemId: 'prod-2', title: 'Game 2', kind: 'game', mediaType: 'game', availability: { regionAvailable: true, soldOut: false } },
          { sourceItemId: 'prod-3', title: 'Game 3', kind: 'game', mediaType: 'game', availability: { regionAvailable: true, soldOut: false } }
        ]
      }
    ],
    products: [
      { sourceItemId: 'prod-1', title: 'Game 1', kind: 'game', mediaType: 'game', availability: { regionAvailable: true, soldOut: false } },
      { sourceItemId: 'prod-2', title: 'Game 2', kind: 'game', mediaType: 'game', availability: { regionAvailable: true, soldOut: false } },
      { sourceItemId: 'prod-3', title: 'Game 3', kind: 'game', mediaType: 'game', availability: { regionAvailable: true, soldOut: false } }
    ]
  };
}

test('two-phase rendering: Phase 1 renders preliminary summary with static pending bullet', () => {
  const { context, doc } = createHarness();
  const F = context.FanaticalLibrary;
  const parsed = createTestBundle();

  const localMatches = [
    { state: 'owned', item: { title: 'Game 1' } },
    { state: 'new' },
    { state: 'new' }
  ];

  F.renderSummary(parsed, localMatches, [], { pendingGalactic: true });

  const summary = doc.querySelector('#fanatical-library-summary');
  assert.ok(summary, 'Summary overlay is mounted in Phase 1');

  // 1. Preliminary headline wording
  const headline = summary.querySelector('.fanatical-library-summary-counts');
  assert.ok(headline, 'Headline counts exist');
  assert.match(headline.textContent, /^Preliminary:/, 'Headline starts with Preliminary:');
  assert.match(headline.textContent, /Owned 1/, 'Headline reports Owned count');
  assert.match(headline.textContent, /Not owned locally 2/, 'Headline reports Not owned locally instead of New');

  // 2. Count help text
  const countHelp = summary.querySelector('.fanatical-library-summary-counts + p');
  assert.ok(countHelp, 'Count help text exists');
  assert.match(countHelp.textContent, /Preliminary local checks\./, 'Count help indicates preliminary checks');

  // 3. Static nonintrusive Galactic Library indicator
  const galacticStatus = summary.querySelector('.fanatical-library-galactic-status');
  assert.ok(galacticStatus, 'Galactic status line exists');
  assert.ok(galacticStatus.classList.contains('fanatical-library-galactic-pending'), 'Status has fanatical-library-galactic-pending class');
  assert.match(galacticStatus.textContent, /Checking Galactic Library…/, 'Status indicates GL check in progress');
  const bullet = galacticStatus.querySelector('.fanatical-library-pending-bullet');
  assert.ok(bullet, 'Static bullet indicator is rendered');
  assert.equal(bullet.textContent, '●', 'Static bullet is ●');

  // 4. Tier breakdown uses preliminary wording
  const tierLi = summary.querySelector('.fanatical-library-tier-list li');
  assert.ok(tierLi, 'Tier row is rendered');
  assert.match(tierLi.textContent, /2 not owned locally \/ 3/, 'Tier row displays not owned locally count');

  // 5. Title breakdown uses preliminary wording
  const newDetails = summary.querySelector('.fanatical-library-title-list[data-section="new"] summary');
  assert.ok(newDetails, 'New items title list disclosure exists');
  assert.match(newDetails.textContent, /Not owned locally \(2\)/, 'Title list heading says Not owned locally');
});

test('two-phase rendering: Phase 2 in-place update seamlessly updates counts, status and preserves open details', () => {
  const { context, doc } = createHarness();
  const F = context.FanaticalLibrary;
  const parsed = createTestBundle();

  // Phase 1 setup
  const localMatches = [
    { state: 'owned', item: { title: 'Game 1' } },
    { state: 'new' },
    { state: 'new' }
  ];

  F.renderSummary(parsed, localMatches, [], { pendingGalactic: true });
  const summaryEl = doc.querySelector('#fanatical-library-summary');
  assert.ok(summaryEl);

  // User opens the new section and advanced section
  const newSection = summaryEl.querySelector('.fanatical-library-title-list[data-section="new"]');
  assert.ok(newSection);
  newSection.open = true;

  const advancedSection = summaryEl.querySelector('.fanatical-library-advanced');
  if (advancedSection) advancedSection.open = true;

  // Phase 2: GL returns finding Game 2 is owned elsewhere!
  const finalMatches = [
    { state: 'owned', item: { title: 'Game 1' } },
    { state: 'owned-elsewhere', item: { title: 'Game 2', provider: 'steam' } },
    { state: 'new' }
  ];
  F.state.galacticEnabled = true;
  F.state.galactic.set('game:game 2', { matches: [{ title: 'Game 2', provider: 'steam', ownership: 'owned' }] });

  F.updateSummary(parsed, finalMatches, []);

  // Verify same root element was updated in-place
  assert.equal(doc.querySelector('#fanatical-library-summary'), summaryEl, 'Root summary element was preserved in-place');

  // Verify settled headline
  const headline = summaryEl.querySelector('.fanatical-library-summary-counts');
  assert.doesNotMatch(headline.textContent, /Preliminary:/, 'Preliminary prefix removed');
  assert.match(headline.textContent, /Owned 1 · Owned elsewhere 1 · New 1/, 'Final combined counts rendered');

  // Verify GL status is complete
  const status = summaryEl.querySelector('.fanatical-library-galactic-status');
  assert.ok(!status.classList.contains('fanatical-library-galactic-pending'), 'Pending class removed');
  assert.match(status.textContent, /Galactic Library: checked linked libraries\./, 'Status reflects complete merge');

  // Verify tier list updated
  const tierLi = summaryEl.querySelector('.fanatical-library-tier-list li');
  assert.match(tierLi.textContent, /1 new \/ 3/, 'Tier row displays final confirmed-new count');

  // Verify open state preserved on title sections
  const updatedNewSection = summaryEl.querySelector('.fanatical-library-title-list[data-section="new"]');
  assert.ok(updatedNewSection, 'New section still present');
  assert.equal(updatedNewSection.open, true, 'User open state was preserved across in-place update');

  const elsewhereSection = summaryEl.querySelector('.fanatical-library-title-list[data-section="owned-elsewhere"]');
  assert.ok(elsewhereSection, 'Elsewhere section newly populated');
});

test('two-phase rendering: incomplete GL state preserves local evidence with retry button', () => {
  const { context, doc } = createHarness();
  const F = context.FanaticalLibrary;
  const parsed = createTestBundle();

  const localMatches = [
    { state: 'owned', item: { title: 'Game 1' } },
    { state: 'new' },
    { state: 'new' }
  ];

  F.renderSummary(parsed, localMatches, [], { pendingGalactic: true });
  const summaryEl = doc.querySelector('#fanatical-library-summary');
  assert.ok(summaryEl);

  // GL fails / times out
  const failedMatches = [
    { state: 'owned', item: { title: 'Game 1' } },
    { state: 'unchecked', lookupIncomplete: true },
    { state: 'unchecked', lookupIncomplete: true }
  ];
  F.state.galacticEnabled = true;
  F.state.failed.add('game:game 2');
  F.state.failed.add('game:game 3');

  F.updateSummary(parsed, failedMatches, []);

  const galacticStatus = summaryEl.querySelector('.fanatical-library-galactic-status');
  assert.match(galacticStatus.textContent, /Galactic Library: check incomplete\. Local results are retained\./, 'Status notes incomplete check');
  const retryBtn = summaryEl.querySelector('.fanatical-library-retry-galactic');
  assert.ok(retryBtn, 'Retry button rendered');
  assert.equal(retryBtn.disabled, false, 'Retry button is enabled');

  const uncheckedSection = summaryEl.querySelector('.fanatical-library-title-list[data-section="unchecked"]');
  assert.ok(uncheckedSection, 'Check incomplete section present in breakdown');
  assert.match(uncheckedSection.querySelector('summary').textContent, /Check incomplete \(2\)/);

  const headline = summaryEl.querySelector('.fanatical-library-summary-counts');
  assert.match(headline.textContent, /Owned 1/, 'Owned count retained');
  assert.match(headline.textContent, /Check incomplete 2/, 'Check incomplete count reported');
});

test('two-phase rendering: stale GL response after revision change is rejected without updating UI', async () => {
  const { context, doc } = createHarness();
  const F = context.FanaticalLibrary;
  const parsed = createTestBundle();

  let finishGlLookup;
  context.chrome.runtime.sendMessage = async (target, request) => {
    const msg = request || target;
    if (msg?.type === 'FANATICAL_GET_PUBLIC_BUNDLE') {
      return {
        ok: true,
        bundle: {
          _id: 'bundle-test',
          name: 'Test Bundle',
          slug: 'test-bundle',
          bundles: [{
            price: { USD: 500 },
            games: [
              { _id: 'prod-1', name: 'Game 1', slug: 'game-1', type: 'game', availability: { regionAvailable: true, soldOut: false } },
              { _id: 'prod-2', name: 'Game 2', slug: 'game-2', type: 'game', availability: { regionAvailable: true, soldOut: false } },
              { _id: 'prod-3', name: 'Game 3', slug: 'game-3', type: 'game', availability: { regionAvailable: true, soldOut: false } }
            ]
          }]
        }
      };
    }
    if (msg?.type === 'MATCH_ITEMS') {
      return new Promise(resolve => { finishGlLookup = resolve; });
    }
    return { ok: true, apiVersion: 1, results: [] };
  };

  // Start initial render
  const renderPromise = F.render();

  // Wait a microtask tick for Phase 1 to run
  await new Promise(resolve => setTimeout(resolve, 10));

  const summaryEl = doc.querySelector('#fanatical-library-summary');
  assert.ok(summaryEl, 'Phase 1 summary mounted');
  const headline = summaryEl.querySelector('.fanatical-library-summary-counts');
  assert.match(headline.textContent, /^Preliminary:/, 'Preliminary headline in Phase 1');

  // User navigates or newer job/storage change occurs
  F.state.revision++;

  // Now the stale GL lookup resolves late
  if (finishGlLookup) {
    finishGlLookup({
      ok: true,
      apiVersion: 1,
      results: [{
        requestId: 'game:game 2',
        matches: [{ title: 'Game 2', provider: 'steam', ownership: 'owned' }]
      }]
    });
  }

  await renderPromise;

  // Verify that headline was NOT updated by the stale response
  assert.match(headline.textContent, /^Preliminary:/, 'Stale GL response does not overwrite UI with settled results');
});

for(const firefox of [false,true])for(const scenario of ['absent','disabled','unlinked','revoked','success','failed','unknown transport','malformed'])test('GL actual render availability lifecycle: '+(firefox?'Firefox ':'Chrome ')+scenario,async()=>{
 const {context:c,doc}=createHarness(),F=c.FanaticalLibrary;
 c.chrome.runtime.getURL=()=>firefox?'moz-extension://fixture/':'chrome-extension://fixture/';
 c.chrome.storage.local.get=async defaults=>({...defaults,galacticLibraryExtensionId:''});
 c.chrome.runtime.sendMessage=async(first,second)=>{
  const m=second||first;
  if(m.type==='FANATICAL_GET_PUBLIC_BUNDLE')return {ok:true,bundle:{_id:'fixture',name:'Fixture',slug:'test-bundle',bundles:[{price:{USD:500},games:[{_id:'p1',name:'Unpurchased game',slug:'p1',type:'game',availability:{regionAvailable:true,soldOut:false}}]}]}};
  if(['absent','disabled'].includes(scenario))throw Error('Could not establish connection. Receiving end does not exist.');
  if(scenario==='unlinked')return {ok:false,error:'This extension is not allowed to use the Galactic Library API.'};
  if(scenario==='unknown transport')throw Error('Unexpected transport failure');
  if(scenario==='malformed')return {ok:true,apiVersion:99};
  if(m.type==='PING')return {ok:true,apiVersion:1};
  if(scenario==='revoked')return {ok:false,error:'This extension is not allowed to use the Galactic Library API.'};
  if(scenario==='failed')throw Error('Could not establish connection. Receiving end does not exist.');
  return {ok:true,apiVersion:1,results:m.items.map(({requestId})=>({requestId,matches:[]}))};
 };
 await F.render();
 const failed=['failed','unknown transport','malformed'].includes(scenario);
 assert.equal(F.state.failed.size,failed?1:0);
 assert.equal(F.state.galacticEnabled,!['absent','disabled','unlinked','revoked'].includes(scenario));
 const headline=doc.querySelector('.fanatical-library-summary-counts').textContent;
 assert.match(headline,failed?/Check incomplete 1/:/New 1/);
 assert.doesNotMatch(headline,/Preliminary/);
});
