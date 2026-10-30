import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeReglages, fill } from './reglages.js';

const setup = () => makeReglages(fs.mkdtempSync(path.join(os.tmpdir(), 'reglages-')));

test('Réglages first, then config.json, then the code default', () => {
  const r = setup();
  assert.equal(r.model('assistant', 'claude-opus-5', 'claude-sonnet-5'), 'claude-opus-5');
  assert.equal(r.model('assistant', undefined, 'claude-sonnet-5'), 'claude-sonnet-5');
  assert.equal(r.effort('assistant', undefined, undefined), undefined);

  r.set('assistant', { model: 'claude-opus-5-5', effort: 'high' });
  assert.equal(r.model('assistant', 'claude-opus-5', 'claude-sonnet-5'), 'claude-opus-5-5');
  assert.equal(r.effort('assistant', 'medium'), 'high');
  assert.equal(r.model('revue', 'claude-haiku-5-5'), 'claude-haiku-5-5');

  r.set('assistant', { model: null });
  assert.equal(r.model('assistant', 'claude-opus-5', 'claude-sonnet-5'), 'claude-opus-5');
  assert.equal(r.effort('assistant', 'medium'), 'high');
  assert.throws(() => r.set('assistant', { model: 'gpt-5' }), /modèle inconnu/);
  assert.throws(() => r.set('assistant', { effort: 'max' }), /effort inconnu/);
});

test('a saved prompt replaces the original until it is reset', () => {
  const r = setup();
  assert.equal(r.prompt('revue', 'origine'), 'origine');
  assert.equal(r.modified('revue'), false);
  r.setPrompt('revue', 'ma version');
  assert.equal(r.prompt('revue', 'origine'), 'ma version');
  assert.equal(r.modified('revue'), true);
  r.resetPrompt('revue');
  assert.equal(r.prompt('revue', 'origine'), 'origine');
  assert.throws(() => r.setPrompt('../x', 'y'), /fonction inconnue/);
  assert.equal(fill('lis {{secondBrain}}, garde {{autre}}', { secondBrain: '/sb' }), 'lis /sb, garde {{autre}}');
});

test('every skill is offered to the agents but the curator, until switched', () => {
  const r = setup();
  assert.equal(r.skillOn('livre-blanc'), true);
  assert.equal(r.skillOn('second-brain-curator'), false);
  r.setSkill('livre-blanc', false);
  r.setSkill('second-brain-curator', true);
  assert.equal(r.skillOn('livre-blanc'), false);
  assert.equal(r.skillOn('second-brain-curator'), true);
});
