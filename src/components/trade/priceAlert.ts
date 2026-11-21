import {isExecutionPrice} from "../../models/execution";

export type Direction = "up" | "down";

export interface PriceAlertLevel {
    threshold: number;
    direction: Direction;
}

export type PriceAlert = PriceAlertLevel & (
    { status: "active" } |
    { status: "triggered"; price: number; time: Date }
);

export const parsePriceAlertLevel = (threshold: number, direction: string): PriceAlertLevel | null =>
    Number.isSafeInteger(threshold) && threshold > 0 && (direction === "up" || direction === "down")
        ? { threshold, direction }
        : null;

export const checkPriceAlert = (
    alert: PriceAlert | null,
    previousPrice: number,
    price: number,
    time: Date,
): PriceAlert | null => {
    if (alert?.status !== "active" || !isExecutionPrice(previousPrice) || !isExecutionPrice(price)) {
        return alert;
    }

    const { threshold, direction } = alert;
    const crossed = direction === "up"
        ? previousPrice < threshold && price >= threshold
        : previousPrice > threshold && price <= threshold;
    return crossed ? { ...alert, status: "triggered", price, time } : alert;
};
