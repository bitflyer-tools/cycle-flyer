export interface Execution {
    side: string;
    price: number;
}

export const executionPriceLimits = (executions: Execution[]) => {
    let highestBuy: number | undefined;
    let lowestSell: number | undefined;
    executions.forEach(({ side, price }) => {
        if (side === "BUY") {
            highestBuy = Math.max(highestBuy ?? price, price);
        } else {
            lowestSell = Math.min(lowestSell ?? price, price);
        }
    });
    return { highestBuy, lowestSell };
};
