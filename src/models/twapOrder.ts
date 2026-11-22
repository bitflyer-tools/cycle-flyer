import {isValidMarketOrderSize} from "./order";

export interface TwapOrder {
    error?: string;
    interval: number;
    remaining: number;
    scheduleId?: symbol;
    slices: number;
    totalSlices: number;
}

const maximumTimerDelay = 2 ** 31 - 1;
export const maximumTwapInterval = maximumTimerDelay / 1000;

export const defaultTwapOrder: TwapOrder = { interval: 60, remaining: 0, slices: 5, totalSlices: 0 };

export const isValidTwapInterval = (interval: number): boolean => {
    const delay = interval * 1000;
    return Number.isFinite(delay) && delay > 0 && delay <= maximumTimerDelay;
};

export const allocateSlices = (size: number, slices: number) => {
    if (!Number.isFinite(size) || size <= 0 || !Number.isInteger(slices) || slices <= 0) {
        return { baseSize: 0, largerSize: 0, largerCount: 0 };
    }
    const units = orderUnits(size);
    const count = BigInt(slices);
    const baseUnits = units / count;
    return {
        baseSize: sizeFromUnits(baseUnits),
        largerSize: sizeFromUnits(baseUnits + BigInt(1)),
        largerCount: Number(units % count),
    };
};

export const isRunning = (twap: TwapOrder): boolean => twap.remaining > 0;

export const canStart = (twap: TwapOrder, size: number): boolean =>
    !isRunning(twap)
    && Number.isInteger(twap.slices)
    && twap.slices > 0
    && isValidTwapInterval(twap.interval)
    && isValidMarketOrderSize(allocateSlices(size, twap.slices).baseSize);

const orderPrecision = 8;

const sizeFromUnits = (units: bigint): number => Number(`${units}e-${orderPrecision}`);

const orderUnits = (size: number): bigint => {
    const [coefficient, exponent = "0"] = size.toString().split("e");
    const [whole, fraction = ""] = coefficient.split(".");
    const digits = whole + fraction;
    const unitDigits = whole.length + Number(exponent) + orderPrecision;
    if (unitDigits <= 0) { return BigInt(0); }
    return BigInt(digits.slice(0, unitDigits) + "0".repeat(Math.max(0, unitDigits - digits.length)));
};
