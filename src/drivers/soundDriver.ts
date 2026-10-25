import Stream from "xstream";

export type Sound = "success" | "failure" | "execution";

export const soundEnabledStorageKey = "sound-enabled";

export const makeSoundDriver = () => {
    let context: AudioContext | null = null;
    const audioContext = (): AudioContext => context = context || new AudioContext();

    return (sound$: Stream<Sound>) => {
        sound$
            .filter((_) => isSoundEnabled())
            .addListener({ next: (sound) => play(audioContext(), tones[sound]) });
    };
};

export const isSoundEnabled = (): boolean => localStorage[soundEnabledStorageKey] !== "false";

const tones: { [sound: string]: number[] } = {
    execution: [660, 990],
    failure: [220, 196],
    success: [880],
};

const play = (context: AudioContext, frequencies: number[]) =>
    frequencies.forEach((frequency, index) => beep(context, frequency, context.currentTime + index * 0.15));

const beep = (context: AudioContext, frequency: number, startAt: number) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.1, startAt);
    gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.12);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + 0.12);
};
