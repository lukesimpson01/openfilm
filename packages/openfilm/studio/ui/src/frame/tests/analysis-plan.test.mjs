import test from'node:test';import assert from'node:assert/strict';import{planSpatialAnalysis as plan,trackMotionExtent}from'../analysis-plan.js';
test('reliable flat shots avoid native reconstruction and heavy masks',()=>{const p=plan({motionExtent:.3,error:.3,inlierShare:.95,advanced:true});assert.equal(p.geometry,'planar');assert.equal(p.foreground,'light');});
test('walking translation with measured visual movement requests calibrated geometry',()=>{assert.equal(plan({sceneMotion:'walking forward',motionExtent:.12}).geometry,'spatial');assert.equal(plan({sceneMotion:'walking forward',motionExtent:0}).geometry,'planar');});
test('detailed masks require a request or a real insertion overlap and sufficient memory',()=>{assert.equal(plan({requested:'spatial',advanced:true}).foreground,'light');assert.equal(plan({requested:'spatial',advanced:true,overlap:true,maskConfidence:.6}).foreground,'detailed');assert.equal(plan({requested:'advanced',advanced:true,availableBytes:1024**3}).foreground,'light');});
test('a missing native runtime remains an explicit planar fallback',()=>{assert.equal(plan({requested:'spatial',native:false}).geometry,'planar');});
test('motion extent comes from actual verified frame transforms',()=>{assert.equal(trackMotionExtent({frames:[{H:[1,0,0,0,1,0,0,0,1]}]},640,480),0);assert.ok(trackMotionExtent({frames:[{H:[1,0,100,0,1,0,0,0,1]}]},640,480)>.15);});

test('walking footage with people takes the calibrated path with detailed masks, without a scene description',async()=>{
  const {trackTranslation}=await import('../analysis-plan.js');
  const walk={frames:Array.from({length:30},(_,i)=>({H:[1+i*.02,0,0,0,1+i*.02,0,0.0004*i,0,1]}))},pan={frames:Array.from({length:30},(_,i)=>({H:[1,0,i,0,1,0,0,0,1]}))};
  assert.ok(trackTranslation(walk,320,180)>.08);assert.equal(trackTranslation(pan,320,180),0);
  const p=plan({motionExtent:.2,translation:trackTranslation(walk,320,180),subjects:true,native:true,advanced:true,availableBytes:6*1024**3});
  assert.equal(p.geometry,'spatial');assert.equal(p.foreground,'detailed');
  assert.equal(plan({motionExtent:.2,translation:0,subjects:true,native:true,advanced:true}).geometry,'planar');
});
