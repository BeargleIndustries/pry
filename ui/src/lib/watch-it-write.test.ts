import { describe, expect, it } from 'vitest';
import {
  clampNewTokens,
  clampTemperature,
  initReplay,
  MAX_NEW_TOKENS,
  pause,
  play,
  showAll,
  stepBy,
  stepSentence,
  temperatureExplanation,
  tick,
  writtenSoFar,
} from './watch-it-write';
import type { GenerationStep } from './types';

// Real gpt2-small greedy output for "The capital of France is" (first 3 steps).
const STEPS: GenerationStep[] = [
  { token: ' now', token_id: 783, probability: 0.048, runner_up: ' the', runner_up_probability: 0.037 },
  { token: ' home', token_id: 1363, probability: 0.111, runner_up: ' the', runner_up_probability: 0.064 },
  { token: ' to', token_id: 284, probability: 0.998, runner_up: ' of', runner_up_probability: 0.001 },
];

describe('replay state', () => {
  it('plays token by token and stops at the end', () => {
    let s = play(initReplay(3));
    expect(s).toEqual({ total: 3, shown: 0, playing: true });
    s = tick(s);
    expect(s.shown).toBe(1);
    s = tick(tick(s));
    expect(s).toEqual({ total: 3, shown: 3, playing: false });
    expect(tick(s)).toEqual(s);
  });

  it('pause freezes; tick while paused does nothing; resume continues', () => {
    let s = tick(play(initReplay(3)));
    s = pause(s);
    expect(tick(s)).toEqual(s);
    s = tick(play(s));
    expect(s.shown).toBe(2);
  });

  it('play from the end restarts', () => {
    const s = play(showAll(initReplay(3)));
    expect(s).toEqual({ total: 3, shown: 0, playing: true });
  });

  it('manual steps clamp and pause', () => {
    let s = play(initReplay(2));
    s = stepBy(s, 5);
    expect(s).toEqual({ total: 2, shown: 2, playing: false });
    expect(stepBy(s, -9).shown).toBe(0);
  });

  it('empty continuation never plays', () => {
    expect(play(initReplay(0)).playing).toBe(false);
  });
});

describe('wording', () => {
  it('says what it picked over what', () => {
    expect(stepSentence(STEPS[0])).toBe('It picked "·now" (5%) over "·the" (4%).');
    expect(stepSentence(STEPS[2])).toBe('It picked "·to" (>99%) over "·of" (<1%).');
  });

  it('is honest when sampling took the less likely word', () => {
    const s = stepSentence({
      token: ' the', token_id: 262, probability: 0.109, runner_up: ' a', runner_up_probability: 0.464,
    });
    expect(s).toContain('over the more likely "·a" (46%)');
    expect(s).toContain('less likely word sometimes wins');
  });

  it('handles a missing runner-up', () => {
    expect(
      stepSentence({ token: 'x', token_id: 1, probability: 1, runner_up: null, runner_up_probability: null }),
    ).toBe('It picked "x" (100%).');
  });

  it('explains temperature in plain words', () => {
    expect(temperatureExplanation(0)).toContain('no randomness');
    expect(temperatureExplanation(0.5)).toContain('sharpened');
    expect(temperatureExplanation(1)).toContain("model's own, unchanged");
    expect(temperatureExplanation(1.6)).toContain('flattened');
  });

  it('writtenSoFar joins the shown tokens', () => {
    expect(writtenSoFar(STEPS, 2)).toBe(' now home');
    expect(writtenSoFar(STEPS, 0)).toBe('');
  });
});

describe('bounds', () => {
  it('clamps length and temperature', () => {
    expect(clampNewTokens(0)).toBe(1);
    expect(clampNewTokens(1000)).toBe(MAX_NEW_TOKENS);
    expect(clampNewTokens(Number.NaN)).toBe(20);
    expect(clampTemperature(-1)).toBe(0);
    expect(clampTemperature(9)).toBe(2);
  });
});

describe('multi-token characters', () => {
  const heart = (text: string, token: string): GenerationStep => ({
    token, token_id: 1, text, probability: 0.5, runner_up: null, runner_up_probability: null,
  });
  it('joins step text, not raw byte pieces', () => {
    const steps = [heart('', '�'), heart('❤', '�'), heart('️', '️')];
    expect(writtenSoFar(steps, 3)).toBe('❤️');
  });
  it('says plainly when a step is only part of a character', () => {
    expect(stepSentence(heart('', '�'))).toMatch(/part of a character/);
  });
});
