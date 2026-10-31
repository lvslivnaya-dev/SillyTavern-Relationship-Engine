import test from 'node:test';
import assert from 'node:assert/strict';
import { withBusy, getBusy, onChangeBusy, resetBusy, setBusyLabel } from '../src/integration/busy.js';

test('withBusy marks thinking only for the duration of the request', async () => {
  resetBusy();
  const events = [];
  const unsubscribe = onChangeBusy(status => events.push(status));
  try {
    assert.equal(getBusy().busy, false);
    let releaseInside;
    const result = await withBusy('анализ ответа…', async () => {
      releaseInside = getBusy();
      return 42;
    });
    assert.equal(result, 42);
    assert.deepEqual(releaseInside, { busy: true, label: 'анализ ответа…' });
    assert.deepEqual(getBusy(), { busy: false, label: null });
    assert.equal(events.length, 2, 'начало и конец');
    assert.equal(events[0].busy, true);
    assert.equal(events[1].busy, false);
  } finally { unsubscribe(); }
});

test('nested requests keep the indicator on and clear the label only at the end', async () => {
  resetBusy();
  const inner = withBusy('лорбук…', () => new Promise(resolve => setTimeout(() => resolve('x'), 10)));
  const outer = withBusy('история…', () => inner);
  await outer;
  assert.deepEqual(getBusy(), { busy: false, label: null });
});

test('a failing request still clears busy and propagates the error', async () => {
  resetBusy();
  await assert.rejects(withBusy('сломается…', async () => { throw new Error('fail'); }), /fail/);
  assert.deepEqual(getBusy(), { busy: false, label: null });
});

test('setBusyLabel updates the visible label of the current request', async () => {
  resetBusy();
  const events = [];
  const unsubscribe = onChangeBusy(status => events.push(status));
  try {
    const promise = withBusy('анализ…', async () => {
      setBusyLabel('уточняю детали…');
      return getBusy().label;
    });
    const labelInside = await promise;
    assert.equal(labelInside, 'уточняю детали…');
    assert.deepEqual(getBusy(), { busy: false, label: null });
    assert.ok(events.some(status => status.label === 'уточняю детали…'));
  } finally { unsubscribe(); resetBusy(); }
});
