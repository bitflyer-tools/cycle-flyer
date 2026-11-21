import {Board} from "./board";
import {BoardOrder} from "./boardOrder";

type MarketFill =
    | { status: "unavailable" }
    | { status: "insufficient" }
    | { status: "estimated"; averagePrice: number; priceDifferencePercent: number };

export interface MarketFills {
    buy: MarketFill;
    sell: MarketFill;
}

export const estimateMarketFills = (board: Board | undefined, size: number): MarketFills | undefined =>
    Number.isFinite(size) && size > 0
        ? { buy: estimateFill(board?.asks, size), sell: estimateFill(board?.bids, size) }
        : undefined;

const estimateFill = (levels: readonly BoardOrder[] | undefined, size: number): MarketFill => {
    let bestPrice: number | undefined;
    let remaining = size;
    let subtractionError = 0;
    let weightedDifference = 0;

    for (const level of levels ?? []) {
        if (!isPositiveFinite(level.price) || !isPositiveFinite(level.size)) { continue; }
        bestPrice ??= level.price;
        const filled = Math.min(remaining, level.size);
        weightedDifference += (filled / size) * (level.price - bestPrice);
        // Carry rounding error forward so it does not accumulate across depth levels.
        const change = -filled - subtractionError;
        const nextRemaining = remaining + change;
        subtractionError = (nextRemaining - remaining) - change;
        remaining = nextRemaining;
        if (remaining <= size * Number.EPSILON) {
            const difference = weightedDifference / (1 - remaining / size);
            return {
                status: "estimated",
                averagePrice: bestPrice + difference,
                priceDifferencePercent: difference / bestPrice * 100,
            };
        }
    }

    return { status: bestPrice === undefined ? "unavailable" : "insufficient" };
};

const isPositiveFinite = (value: number): boolean => Number.isFinite(value) && value > 0;
