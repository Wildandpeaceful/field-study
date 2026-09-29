const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../public/output-format.js'), 'utf8');
function load(saved) {
  const events = [];
  let storage = saved || null;
  const context = {
    window: { dispatchEvent(event) { events.push(event); } },
    document: { readyState: 'loading', addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } },
    localStorage: { getItem() { return storage; }, setItem(key, value) { storage = value; } },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
  };
  vm.runInNewContext(source, context);
  return { format: context.window.outputFormat, events, saved: () => storage };
}
const {format, events, saved} = load();
const size = value => JSON.parse(JSON.stringify(value));
format.set('square', 'reflow', 3000);
assert.deepEqual(size(format.get().dimensions), {width:3000, height:3000});
assert.deepEqual(size(format.logicalDimensions()), {width:900, height:900});
assert.equal(events.at(-1).detail.outputSizeChanged, true);
assert.equal(load(saved()).format.get().shortEdge, 3000, 'Resolution survives reload');
for (const [id, width, height] of [['three-four',3000,4000],['four-five',3000,3750],['story',3000,5333],['wide',5333,3000]]) {
  format.set(id);
  assert.deepEqual(size(format.get().dimensions), {width,height});
  assert.equal(events.at(-1).detail.outputSizeChanged, false, 'Ratio-only changes keep resolution');
}
format.setOutputSize(1350);
assert.equal(events.at(-1).detail.outputSizeChanged, true);
format.setOutputSize(8000);
assert.equal(format.get().shortEdge, 1350, 'Unsupported output sizes cannot be selected');
// The legacy square-JPEG path temporarily changes ratio without changing the selected output size.
format.set('square');
assert.equal(format.get().shortEdge, 1350);
assert.equal(events.at(-1).detail.outputSizeChanged, false);
format.set('wide');
assert.deepEqual(size(format.get().dimensions), {width:2400,height:1350});
assert.equal(load('{broken').format.get().shortEdge, 900);
assert.equal(load(JSON.stringify({id:'square',shortEdge:999999})).format.get().shortEdge, 900);
console.log('Canvas resolution, ratios, persistence, and temporary JPEG framing passed.');
