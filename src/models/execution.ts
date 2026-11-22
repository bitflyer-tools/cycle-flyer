export interface Execution {
    side: string;
    price: number;
}

export const isExecutionPrice = (price: number): boolean =>
    Number.isFinite(price) && price > 0;

export const isExecution = (value: unknown): value is Execution =>
    typeof value === "object" && value !== null
    && "side" in value && (value.side === "BUY" || value.side === "SELL" || value.side === "")
    && "price" in value && typeof value.price === "number" && isExecutionPrice(value.price);

export const executionPriceLimits = (executions: Execution[]) => {
    let highestBuy: number | undefined;
    let lowestSell: number | undefined;
    executions.forEach(({ side, price }) => {
        if (!isExecutionPrice(price)) { return; }
        if (side === "BUY") {
            highestBuy = Math.max(highestBuy ?? price, price);
        } else {
            lowestSell = Math.min(lowestSell ?? price, price);
        }
    });
    return { highestBuy, lowestSell };
};
