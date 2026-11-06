import assert from 'node:assert/strict';
import test from 'node:test';
import { managedLineup, XtreamLineupRulesSchema } from './lineup-manager.js';
import type { Lineup } from './lineup.js';

function fixture(): Lineup {
  // First two channels are in UK, the third is in News, and one has both.
  return {
    groups: ['UK', 'News'],
    members: [Int32Array.from([0, 1]), Int32Array.from([1, 2])],
    streamIds: Float64Array.from([100, 200, 300, 400]),
    numbers: Uint32Array.from([1, 2, 3, 4]),
    groupOf: Int32Array.from([0, 0, 1, -1]),
  } as Lineup;
}
const rules = (overrides: Partial<ReturnType<typeof XtreamLineupRulesSchema.parse>> = {}) =>
  XtreamLineupRulesSchema.parse(overrides);

test('unchanged preferences preserve provider order and groups', () => {
  const view = managedLineup(fixture(), rules());
  assert.deepEqual(view.groups, ['UK', 'News']);
  assert.deepEqual(view.indices, [0, 1, 2, 3]);
  assert.deepEqual(view.byGroup.get('UK'), [0, 1]);
});

test('hide a group but keep a channel belonging to another visible group', () => {
  const view = managedLineup(fixture(), rules({ hiddenGroups: ['UK'] }));
  assert.deepEqual(view.groups, ['News']);
  assert.deepEqual(view.indices, [1, 2, 3]);
  assert.equal(view.visible.has(0), false);
  assert.equal(view.firstGroup.get(1), 'News');
});

test('hide a specific stream by stable provider ID', () => {
  const view = managedLineup(fixture(), rules({ hiddenChannels: [200] }));
  assert.deepEqual(view.indices, [0, 2, 3]);
  assert.deepEqual(view.byGroup.get('News'), [2]);
});

test('explicit channel and group order come first, remaining entries keep provider order', () => {
  const view = managedLineup(
    fixture(),
    rules({ groupOrder: ['News'], channelOrder: [300, 100] })
  );
  assert.deepEqual(view.groups, ['News', 'UK']);
  assert.deepEqual(view.indices, [2, 0, 1, 3]);
  assert.deepEqual(view.byGroup.get('News'), [2, 1]);
});

test('stale IDs, repeated IDs and unknown groups do not create phantom entries', () => {
  const view = managedLineup(
    fixture(),
    rules({ groupOrder: ['Missing', 'UK', 'UK'], channelOrder: [999, 300, 300] })
  );
  assert.deepEqual(view.groups, ['UK', 'News']);
  assert.deepEqual(view.indices, [2, 0, 1, 3]);
});

test('separate configurations never mutate the cached provider lineup', () => {
  const source = fixture();
  const hidden = managedLineup(source, rules({ hiddenChannels: [100] }));
  const full = managedLineup(source, rules());
  assert.deepEqual(hidden.indices, [1, 2, 3]);
  assert.deepEqual(full.indices, [0, 1, 2, 3]);
  assert.deepEqual(Array.from(source.members[0]), [0, 1]);
});

test('malformed IDs cannot enter the stored policy', () => {
  assert.equal(
    XtreamLineupRulesSchema.safeParse({ hiddenChannels: ['not-a-number'] }).success,
    false
  );
});
