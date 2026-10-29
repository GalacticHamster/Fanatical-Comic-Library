// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Galactic Hamster
import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/purchase-snapshot.js';
import '../src/purchase-adapters.js';
test('shared adapter retains exact Humble key-reference compatibility without accepting product or positional IDs',()=>{
 const alias=globalThis.GalacticPurchaseAdapters.humbleEntitlementAlias;
 assert.equal(alias('order:key:machine:0','order'),'order:entitlement:machine:0');
 assert.equal(alias('order:entitlement:machine:0','order'),'order:key:machine:0');
 for(const id of ['order:product:machine:0','order:key:position-0:0','order:key:machine','other:key:machine:0'])assert.equal(alias(id,'order'),null);
});
