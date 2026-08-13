import { useCallback, useEffect, useRef, useState } from 'react';

export function tempoFromTaps(taps: number[]): number | null {
  if (taps.length < 2) return null;
  const recent = taps.slice(-6);
  const intervals = recent.slice(1).map((tap, index) => tap - recent[index]).filter((value) => value >= 220 && value <= 2_000);
  if (intervals.length === 0) return null;
  const average = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
  return Math.max(30, Math.min(240, Math.round(60_000 / average)));
}

function playClick(context: AudioContext, accent: boolean): void {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(accent ? 1_180 : 820, context.currentTime);
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(accent ? 0.22 : 0.14, context.currentTime + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.055);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(context.currentTime);
  oscillator.stop(context.currentTime + 0.065);
}

export function useMetronome(initialBpm: number) {
  const [bpm, setBpmState] = useState(Math.max(30, Math.min(240, Math.round(initialBpm))));
  const [running, setRunning] = useState(false);
  const [beat, setBeat] = useState(0);
  const contextRef = useRef<AudioContext | null>(null);
  const tapsRef = useRef<number[]>([]);

  const setBpm = useCallback((value: number) => {
    setBpmState(Math.max(30, Math.min(240, Math.round(value))));
  }, []);

  const toggle = useCallback(async () => {
    if (running) {
      setRunning(false);
      return;
    }
    if (typeof AudioContext !== 'undefined') {
      contextRef.current ??= new AudioContext();
      if (contextRef.current.state === 'suspended') await contextRef.current.resume();
    }
    setBeat(0);
    setRunning(true);
  }, [running]);

  const tap = useCallback((time = performance.now()) => {
    const previous = tapsRef.current.at(-1);
    tapsRef.current = previous && time - previous <= 2_000 ? [...tapsRef.current, time].slice(-6) : [time];
    const next = tempoFromTaps(tapsRef.current);
    if (next !== null) setBpm(next);
    return next;
  }, [setBpm]);

  useEffect(() => {
    if (!running) return;
    let currentBeat = 0;
    const tick = () => {
      currentBeat = (currentBeat % 4) + 1;
      setBeat(currentBeat);
      if (contextRef.current) playClick(contextRef.current, currentBeat === 1);
    };
    tick();
    const timer = window.setInterval(tick, 60_000 / bpm);
    return () => window.clearInterval(timer);
  }, [bpm, running]);

  useEffect(() => () => {
    void contextRef.current?.close();
    contextRef.current = null;
  }, []);

  return { bpm, beat, running, setBpm, tap, toggle };
}
