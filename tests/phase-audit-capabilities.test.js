import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeFeatures,VARIANTS} from '../advanced/features.js';

test('revision 5 audit candidate retains existing reference and five-key capabilities',()=>{
  for(const [index,variant] of VARIANTS.entries()){
    const reply=Uint8Array.from([161,0,0,17,1,126,76,70,1,0,76,70,51,51,1,34,32,index+1,variant.mask,
      variant.debounce==='none'?0:2,variant.debounce==='none'?0:5,5,63]);
    if(variant.phase==='none'){assert.throws(()=>decodeFeatures(reply));continue;}
    const value=decodeFeatures(reply);
    assert.equal(value.phaseAudit,true);assert.equal(value.phaseReference,true);
    assert.equal(value.phaseDiagnostics,true);assert.equal(value.implementationRevision,5);
    if(variant.debounce!=='none'){assert.equal(value.buttonCount,5);assert.equal(value.independentDebounce,true);}
    for(const flags of [7,15,31,62,255]){reply[22]=flags;assert.throws(()=>decodeFeatures(reply));}
  }
});

test('revision 6 identifies frozen rejection snapshots without accepting revision-5 flags',()=>{
  const reply=Uint8Array.from([161,0,0,17,1,126,76,70,1,0,76,70,51,51,1,34,32,1,43,2,5,6,127]);
  const value=decodeFeatures(reply);
  assert.equal(value.phaseAuditSchema,2);assert.equal(value.phaseReferenceSchema,1);
  assert.equal(value.independentDebounce,true);assert.equal(value.buttonCount,5);
  reply[22]=63;assert.throws(()=>decodeFeatures(reply));
});

test('revision 7 selects the projection audit schema and preserves each variant capability',()=>{
  for(const [index,variant] of VARIANTS.entries()){
    const reply=Uint8Array.from([161,0,0,17,1,126,76,70,1,0,76,70,51,51,1,34,32,index+1,variant.mask,
      variant.debounce==='none'?0:2,variant.debounce==='none'?0:5,7,127]);
    if(variant.phase==='none'){assert.throws(()=>decodeFeatures(reply));continue;}
    const value=decodeFeatures(reply);
    assert.equal(value.implementationRevision,7);assert.equal(value.phaseAuditSchema,3);
    assert.equal(value.phaseReferenceSchema,1);assert.equal(value.phaseDiagnosticSchema,1);
    assert.equal(value.phase,variant.phase);assert.equal(value.debounce,variant.debounce);
    if(variant.debounce!=='none'){assert.equal(value.independentDebounce,true);assert.equal(value.buttonCount,5);}
    for(const flags of [31,63,126,255]){reply[22]=flags;assert.throws(()=>decodeFeatures(reply));}
  }
});

test('revision 8 requires timestamp-audit flags and selects its own frozen schema',()=>{
  for(const [index,variant] of VARIANTS.entries()){
    const reply=Uint8Array.from([161,0,0,17,1,126,76,70,1,0,76,70,51,51,1,34,32,index+1,variant.mask,
      variant.debounce==='none'?0:2,variant.debounce==='none'?0:5,8,255]);
    if(variant.phase==='none'){assert.throws(()=>decodeFeatures(reply));continue;}
    const value=decodeFeatures(reply);
    assert.equal(value.implementationRevision,8);assert.equal(value.phaseAuditSchema,4);
    assert.equal(value.phaseReferenceSchema,1);assert.equal(value.phaseDiagnosticSchema,1);
    assert.equal(value.phase,variant.phase);assert.equal(value.debounce,variant.debounce);
    if(variant.debounce!=='none'){assert.equal(value.buttonCount,5);assert.equal(value.independentDebounce,true);}
    for(const flags of [63,127,254]){reply[22]=flags;assert.throws(()=>decodeFeatures(reply));}
  }
});

test('revision 9 identifies the one-Stamp mapping schema',()=>{
  for(const [index,variant] of VARIANTS.entries()){
    const reply=Uint8Array.from([161,0,0,17,1,126,76,70,1,0,76,70,51,51,1,34,32,index+1,variant.mask,
      variant.debounce==='none'?0:2,variant.debounce==='none'?0:5,9,255]);
    if(variant.phase==='none'){assert.throws(()=>decodeFeatures(reply));continue;}
    const value=decodeFeatures(reply);
    assert.equal(value.implementationRevision,9);assert.equal(value.phaseAuditSchema,5);
    assert.equal(value.phaseReferenceSchema,1);assert.equal(value.phaseDiagnosticSchema,1);
    assert.equal(value.phase,variant.phase);assert.equal(value.debounce,variant.debounce);
    if(variant.debounce!=='none'){assert.equal(value.buttonCount,5);assert.equal(value.independentDebounce,true);}
    for(const flags of [63,127,254]){reply[22]=flags;assert.throws(()=>decodeFeatures(reply));}
  }
});

test('revision 10 keeps schema 5 for adaptive reference refresh',()=>{
  for(const [index,variant] of VARIANTS.entries()){
    const reply=Uint8Array.from([161,0,0,17,1,126,76,70,1,0,76,70,51,51,1,34,32,index+1,variant.mask,
      variant.debounce==='none'?0:2,variant.debounce==='none'?0:5,10,255]);
    if(variant.phase==='none'){assert.throws(()=>decodeFeatures(reply));continue;}
    const value=decodeFeatures(reply);
    assert.equal(value.implementationRevision,10);assert.equal(value.phaseAuditSchema,5);
    assert.equal(value.phaseReferenceSchema,1);assert.equal(value.phaseDiagnosticSchema,1);
    assert.equal(value.phase,variant.phase);assert.equal(value.debounce,variant.debounce);
    if(variant.debounce!=='none'){assert.equal(value.buttonCount,5);assert.equal(value.independentDebounce,true);}
    for(const flags of [63,127,254]){reply[22]=flags;assert.throws(()=>decodeFeatures(reply));}
  }
});

test('revision 11 keeps the snapshot ABI with an independent controller clock',()=>{
  for(const [index,variant] of VARIANTS.entries()){
    const reply=Uint8Array.from([161,0,0,17,1,126,76,70,1,0,76,70,51,51,1,34,32,index+1,variant.mask,
      variant.debounce==='none'?0:2,variant.debounce==='none'?0:5,11,255]);
    if(variant.phase==='none'){assert.throws(()=>decodeFeatures(reply));continue;}
    const value=decodeFeatures(reply);
    assert.equal(value.implementationRevision,11);assert.equal(value.phaseAuditSchema,5);
    assert.equal(value.phaseReferenceSchema,1);assert.equal(value.phaseDiagnosticSchema,1);
    assert.equal(value.phase,variant.phase);assert.equal(value.debounce,variant.debounce);
    if(variant.debounce!=='none'){assert.equal(value.buttonCount,5);assert.equal(value.independentDebounce,true);}
    for(const flags of [63,127,254]){reply[22]=flags;assert.throws(()=>decodeFeatures(reply));}
  }
});

test('revision 12 keeps the independent clock and shorter mapping path ABI',()=>{
  for(const [index,variant] of VARIANTS.entries()){
    const reply=Uint8Array.from([161,0,0,17,1,126,76,70,1,0,76,70,51,51,1,34,32,index+1,variant.mask,
      variant.debounce==='none'?0:2,variant.debounce==='none'?0:5,12,255]);
    if(variant.phase==='none'){assert.throws(()=>decodeFeatures(reply));continue;}
    const value=decodeFeatures(reply);
    assert.equal(value.implementationRevision,12);assert.equal(value.phaseAuditSchema,5);
    assert.equal(value.phaseReferenceSchema,1);assert.equal(value.phaseDiagnosticSchema,1);
    assert.equal(value.phase,variant.phase);assert.equal(value.debounce,variant.debounce);
    if(variant.debounce!=='none'){assert.equal(value.buttonCount,5);assert.equal(value.independentDebounce,true);}
    for(const flags of [63,127,254]){reply[22]=flags;assert.throws(()=>decodeFeatures(reply));}
  }
});

test('revision 13 keeps schema 5 while event diagnostics use a separate operation',()=>{
  for(const [index,variant] of VARIANTS.entries()){
    const reply=Uint8Array.from([161,0,0,17,1,126,76,70,1,0,76,70,51,51,1,34,32,index+1,variant.mask,
      variant.debounce==='none'?0:2,variant.debounce==='none'?0:5,13,255]);
    if(variant.phase==='none'){assert.throws(()=>decodeFeatures(reply));continue;}
    const value=decodeFeatures(reply);
    assert.equal(value.implementationRevision,13);assert.equal(value.phaseAuditSchema,5);
    assert.equal(value.phaseReferenceSchema,1);assert.equal(value.phaseDiagnosticSchema,1);
    assert.equal(value.phase,variant.phase);assert.equal(value.debounce,variant.debounce);
    if(variant.debounce!=='none'){assert.equal(value.buttonCount,5);assert.equal(value.independentDebounce,true);}
    for(const flags of [63,127,254]){reply[22]=flags;assert.throws(()=>decodeFeatures(reply));}
  }
});

test('revision 14 keeps diagnostics while expiry refreshes the next frame',()=>{
  for(const [index,variant] of VARIANTS.entries()){
    const reply=Uint8Array.from([161,0,0,17,1,126,76,70,1,0,76,70,51,51,1,34,32,index+1,variant.mask,
      variant.debounce==='none'?0:2,variant.debounce==='none'?0:5,14,255]);
    if(variant.phase==='none'){assert.throws(()=>decodeFeatures(reply));continue;}
    const value=decodeFeatures(reply);
    assert.equal(value.implementationRevision,14);assert.equal(value.phaseAuditSchema,5);
    assert.equal(value.phaseReferenceSchema,1);assert.equal(value.phaseDiagnosticSchema,1);
    assert.equal(value.phase,variant.phase);assert.equal(value.debounce,variant.debounce);
    if(variant.debounce!=='none'){assert.equal(value.buttonCount,5);assert.equal(value.independentDebounce,true);}
    for(const flags of [63,127,254]){reply[22]=flags;assert.throws(()=>decodeFeatures(reply));}
  }
});


test('revision 15 preserves schema 5 while clock-offset events use schema 2',()=>{
  for(const [index,variant] of VARIANTS.entries()){
    const reply=Uint8Array.from([161,0,0,17,1,126,76,70,1,0,76,70,51,51,1,34,32,index+1,variant.mask,
      variant.debounce==='none'?0:2,variant.debounce==='none'?0:5,15,255]);
    if(variant.phase==='none'){assert.throws(()=>decodeFeatures(reply));continue;}
    const value=decodeFeatures(reply);
    assert.equal(value.implementationRevision,15);assert.equal(value.phaseAuditSchema,5);
    assert.equal(value.phaseReferenceSchema,1);assert.equal(value.phaseDiagnosticSchema,1);
    if(variant.debounce!=='none'){assert.equal(value.buttonCount,5);assert.equal(value.independentDebounce,true);}
    for(const flags of [63,127,254]){reply[22]=flags;assert.throws(()=>decodeFeatures(reply));}
  }
});


test('revision 16 identifies the independent read-clock protocol',()=>{
  for(const [index,variant] of VARIANTS.entries()){
    const reply=Uint8Array.from([161,0,0,17,1,126,76,70,1,0,76,70,51,51,1,34,32,index+1,variant.mask,
      variant.debounce==='none'?0:2,variant.debounce==='none'?0:5,16,255]);
    if(variant.phase==='none'){assert.throws(()=>decodeFeatures(reply));continue;}
    const value=decodeFeatures(reply);
    assert.equal(value.implementationRevision,16);assert.equal(value.phaseAuditSchema,5);
    assert.equal(value.phaseReferenceSchema,1);assert.equal(value.phaseDiagnosticSchema,1);
    if(variant.debounce!=='none'){assert.equal(value.buttonCount,5);assert.equal(value.independentDebounce,true);}
    for(const flags of [63,127,254]){reply[22]=flags;assert.throws(()=>decodeFeatures(reply));}
  }
});

test('revision 17 retains read-clock diagnostics with bounded reference retries',()=>{
  for(const [index,variant] of VARIANTS.entries()){
    const reply=Uint8Array.from([161,0,0,17,1,126,76,70,1,0,76,70,51,51,1,34,32,index+1,variant.mask,
      variant.debounce==='none'?0:2,variant.debounce==='none'?0:5,17,255]);
    if(variant.phase==='none'){assert.throws(()=>decodeFeatures(reply));continue;}
    const value=decodeFeatures(reply);
    assert.equal(value.implementationRevision,17);assert.equal(value.phaseAuditSchema,5);
    assert.equal(value.phaseReferenceSchema,1);assert.equal(value.phaseDiagnosticSchema,1);
    if(variant.debounce!=='none'){assert.equal(value.buttonCount,5);assert.equal(value.independentDebounce,true);}
    for(const flags of [63,127,254]){reply[22]=flags;assert.throws(()=>decodeFeatures(reply));}
  }
});

test('revision 18 retains the ABI with elapsed reference refresh and native fallback',()=>{
  for(const [index,variant] of VARIANTS.entries()){
    const reply=Uint8Array.from([161,0,0,17,1,126,76,70,1,0,76,70,51,51,1,34,32,index+1,variant.mask,
      variant.debounce==='none'?0:2,variant.debounce==='none'?0:5,18,255]);
    if(variant.phase==='none'){assert.throws(()=>decodeFeatures(reply));continue;}
    const value=decodeFeatures(reply);
    assert.equal(value.implementationRevision,18);assert.equal(value.phaseAuditSchema,5);
    assert.equal(value.phaseReferenceSchema,1);assert.equal(value.phaseDiagnosticSchema,1);
    if(variant.debounce!=='none'){assert.equal(value.buttonCount,5);assert.equal(value.independentDebounce,true);}
    for(const flags of [63,127,254]){reply[22]=flags;assert.throws(()=>decodeFeatures(reply));}
  }
});

test('revision 19 preserves reference diagnostics and per-key capabilities after the SPI watchdog fix',()=>{
  for(const [index,variant] of VARIANTS.entries()){
    const reply=Uint8Array.from([161,0,0,17,1,126,76,70,1,0,76,70,51,51,1,34,32,index+1,variant.mask,
      variant.debounce==='none'?0:2,variant.debounce==='none'?0:5,19,255]);
    if(variant.phase==='none'){assert.throws(()=>decodeFeatures(reply));continue;}
    const value=decodeFeatures(reply);
    assert.equal(value.implementationRevision,19);assert.equal(value.phaseAuditSchema,5);
    assert.equal(value.phaseReferenceSchema,1);assert.equal(value.phaseDiagnosticSchema,1);
    if(variant.debounce!=='none'){assert.equal(value.buttonCount,5);assert.equal(value.independentDebounce,true);}
    for(const flags of [63,127,254]){reply[22]=flags;assert.throws(()=>decodeFeatures(reply));}
    reply[21]=22;reply[22]=255;assert.throws(()=>decodeFeatures(reply));
  }
});

test('revision 20 recognizes the actual motion-publication candidate INFO',()=>{
  for(const target of [0,2]){
    const reply=Uint8Array.from(Buffer.from('a1000011017e4c4601004c463333012220012b020514ff','hex'));
    reply[2]=target;
    const value=decodeFeatures(reply);
    assert.equal(value.implementationRevision,20);
    assert.equal(value.phaseAuditSchema,5);
    assert.equal(value.buttonCount,5);
    assert.equal(value.independentDebounce,true);
    reply[22]=254;assert.throws(()=>decodeFeatures(reply));
  }
});

test('revision 21 retains diagnostics while using stable sensor read cadence',()=>{
  for(const target of [0,2]){
    const reply=Uint8Array.from(Buffer.from('a1000011017e4c4601004c463333012220012b020515ff','hex'));
    reply[2]=target;const value=decodeFeatures(reply);
    assert.equal(value.implementationRevision,21);assert.equal(value.phaseAuditSchema,5);
    assert.equal(value.buttonCount,5);assert.equal(value.independentDebounce,true);
    reply[22]=254;assert.throws(()=>decodeFeatures(reply));
  }
});
