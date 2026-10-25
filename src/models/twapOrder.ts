export interface TwapOrder {
    interval: number;
    remaining: number;
    slices: number;
}

export const minimumOrderSize = 0.01;

export const defaultTwapOrder: TwapOrder = { interval: 60, remaining: 0, slices: 5 };

export const sliceSize = (size: number, slices: number): number =>
    slices > 0 ? Math.floor(size / slices * 100000000) / 100000000 : 0;

export const isRunning = (twap: TwapOrder): boolean => twap.remaining > 0;

export const canStart = (twap: TwapOrder, size: number): boolean =>
    !isRunning(twap)
    && Number.isInteger(twap.slices)
    && twap.slices > 0
    && twap.interval > 0
    && sliceSize(size, twap.slices) >= minimumOrderSize;
