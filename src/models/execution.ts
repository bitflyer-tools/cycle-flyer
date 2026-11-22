export interface Execution {
    side: string;
    price: number;
}

export interface MarketExecution extends Execution {
    id: number;
    exec_date: string;
    size: number;
    side: "BUY" | "SELL" | "";
}

export const executionTime = (date: string): number =>
    Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(date) ? date : date + "Z");

export const isMarketExecution = (value: unknown): value is MarketExecution => {
    if (!value || typeof value !== "object") { return false; }
    const { id, side, price, size, exec_date } = value as MarketExecution;
    return Number.isSafeInteger(id) && id > 0 && (side === "BUY" || side === "SELL" || side === "")
        && isExecutionPrice(price) && Number.isFinite(size) && size > 0
        && typeof exec_date === "string" && Number.isFinite(executionTime(exec_date));
};

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
