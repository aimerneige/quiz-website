import test from 'node:test';
import assert from 'node:assert/strict';
import {assignSorts, diffSync, syncKey} from '../src/core.js';

const q = (id, text = id) => ({id, question: text, hint: '', answer: '', tags: []});
const ordered = (list, sorts) => list.every((item, i) => i === 0 || sorts.get(item.id) > sorts.get(list[i - 1].id));

test('assignSorts keeps existing keys and fits new questions between neighbours', () => {
  const first = assignSorts([q('a'), q('b'), q('c')]);
  assert.deepEqual([...first.values()], [1, 2, 3]);
  const prepended = assignSorts([q('new'), q('a'), q('b'), q('c')], first);
  assert.equal(prepended.get('a'), 1);
  assert.ok(prepended.get('new') < 1);
  const restored = assignSorts([q('a'), q('x'), q('y'), q('c'), q('z')], first);
  assert.equal(restored.get('a'), 1);
  assert.equal(restored.get('c'), 3);
  assert.ok(ordered([q('a'), q('x'), q('y'), q('c'), q('z')], restored));
});

test('assignSorts renumbers when keys run out of precision or the order changed', () => {
  const tight = new Map([['a', 1], ['b', 1 + Number.EPSILON]]);
  const list = [q('a'), q('n1'), q('n2'), q('b')];
  const sorts = assignSorts(list, tight);
  assert.ok(ordered(list, sorts));
  const swapped = assignSorts([q('b'), q('a')], new Map([['a', 1], ['b', 2]]));
  assert.ok(ordered([q('b'), q('a')], swapped));
});

test('diffSync only uploads changed questions and removes deleted ones', () => {
  const list = [q('a'), q('b'), q('c')];
  const sorts = assignSorts(list);
  const synced = new Map(list.map(item => [item.id, syncKey(item, sorts.get(item.id))]));
  assert.deepEqual(diffSync(synced, list, sorts), {upsert: [], remove: []});
  const next = [q('a', 'edited'), q('c'), q('d')];
  const nextSorts = assignSorts(next, sorts);
  const diff = diffSync(synced, next, nextSorts);
  assert.deepEqual(diff.upsert.map(item => item.id), ['a', 'd']);
  assert.deepEqual(diff.remove, ['b']);
});
