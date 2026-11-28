export interface OrderHistory {
    createdAt: Date;
    description: string;
    name: string;
    status: string;
    rejectionReason?: string;
    timedOut?: boolean;
}

export const HISTORY_LIMIT = 100;

export const prependOrderHistory = (histories: readonly OrderHistory[], history: OrderHistory): readonly OrderHistory[] =>
    prependOrderHistories(histories, [history]);

export const prependOrderHistories = (
    histories: readonly OrderHistory[],
    incoming: readonly OrderHistory[],
): readonly OrderHistory[] => {
    if (incoming.length === 0 && histories.length <= HISTORY_LIMIT) return histories;
    const newest = incoming.slice(-HISTORY_LIMIT).reverse();
    return newest.concat(histories.slice(0, HISTORY_LIMIT - newest.length));
};

export const createOrderHistory = (
    name: string,
    side: string,
    size: number,
    price: number,
    status: string,
): OrderHistory => ({
    createdAt: new Date(),
    description: `${side} / ${size} / ${(price && price.toLocaleString()) || "MARKET"}`,
    name,
    status,
});
