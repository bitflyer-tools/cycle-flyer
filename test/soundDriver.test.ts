import assert from "node:assert/strict";
import {test, TestContext} from "node:test";
import Stream from "xstream";
import {isSoundEnabled, makeSoundDriver, Sound, soundEnabledStorageKey} from "../src/drivers/soundDriver";

function withLocalStorage(t: TestContext, value: Record<string, string>): void {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value });
    t.after(() => {
        if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
        else Reflect.deleteProperty(globalThis, "localStorage");
    });
}

class FakeNode {
    connect(node: unknown): unknown { return node; }
}

class FakeOscillator extends FakeNode {
    frequency = { value: 0 };
    started: number[] = [];
    stopped: number[] = [];
    start(time: number): void { this.started.push(time); }
    stop(time: number): void { this.stopped.push(time); }
}

class FakeGain extends FakeNode {
    gain = {
        setValueAtTime: (_value: number, _time: number) => {},
        exponentialRampToValueAtTime: (_value: number, _time: number) => {},
    };
}

function withAudioContext(t: TestContext): { instances: number; oscillators: FakeOscillator[] } {
    const state = { instances: 0, oscillators: [] as FakeOscillator[] };
    const original = (globalThis as any).AudioContext;
    (globalThis as any).AudioContext = class {
        currentTime = 0;
        destination = {};
        constructor() { state.instances += 1; }
        createOscillator() {
            const oscillator = new FakeOscillator();
            state.oscillators.push(oscillator);
            return oscillator;
        }
        createGain() { return new FakeGain(); }
    };
    t.after(() => { (globalThis as any).AudioContext = original; });
    return state;
}

test("sound is enabled by default and disabled only when the flag is exactly \"false\"", (t) => {
    withLocalStorage(t, {});
    assert.equal(isSoundEnabled(), true);
    withLocalStorage(t, { [soundEnabledStorageKey]: "false" });
    assert.equal(isSoundEnabled(), false);
    withLocalStorage(t, { [soundEnabledStorageKey]: "true" });
    assert.equal(isSoundEnabled(), true);
});

test("the driver plays each tone of a sound and reuses a single audio context", (t) => {
    withLocalStorage(t, {});
    const audio = withAudioContext(t);

    const sound$ = Stream.create<Sound>();
    makeSoundDriver()(sound$);
    sound$.shamefullySendNext("execution");
    sound$.shamefullySendNext("success");

    assert.equal(audio.instances, 1);
    assert.deepEqual(audio.oscillators.map((oscillator) => oscillator.frequency.value), [660, 990, 880]);
    assert.deepEqual(audio.oscillators.map((oscillator) => oscillator.started), [[0], [0.15], [0]]);
    assert.deepEqual(audio.oscillators.map((oscillator) => oscillator.stopped), [[0.12], [0.27], [0.12]]);
});

test("the driver stays silent when sound is disabled", (t) => {
    withLocalStorage(t, { [soundEnabledStorageKey]: "false" });
    const audio = withAudioContext(t);

    const sound$ = Stream.create<Sound>();
    makeSoundDriver()(sound$);
    sound$.shamefullySendNext("failure");

    assert.equal(audio.instances, 0);
    assert.deepEqual(audio.oscillators, []);
});
