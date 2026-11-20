import {ceilBy, floorBy} from "../util";
import {BoardOrder} from "./boardOrder";
import {Execution} from "./execution";

const visibleRows = 200;
const ascendingPrice = (a: BoardOrder, b: BoardOrder): number => a.price - b.price;
const descendingPrice = (a: BoardOrder, b: BoardOrder): number => b.price - a.price;

export class Board {
    public asks: BoardOrder[];
    public bids: BoardOrder[];

    constructor(json: any) {
        this.asks = json.asks.map((ask: object) => new BoardOrder(ask)).sort(ascendingPrice);
        this.bids = json.bids.map((bid: object) => new BoardOrder(bid)).sort(descendingPrice);
    }

    public spread(): number {
        const upper = (this.asks[0] || { price: 0 }).price;
        const lower = (this.bids[0] || { price: 0 }).price;
        return upper - lower;
    }

    public remove(side: string, price: number) {
        if (side === "BUY") {
            this.asks = this.asks.filter((ask) => ask.price >= price);
        } else {
            this.bids = this.bids.filter((bid) => bid.price <= price);
        }
    }

    public removeExecutions(executions: Execution[]): void {
        let highestBuy: number | undefined;
        let lowestSell: number | undefined;
        executions.forEach(({ side, price }) => {
            if (side === "BUY") {
                highestBuy = Math.max(highestBuy ?? price, price);
            } else {
                lowestSell = Math.min(lowestSell ?? price, price);
            }
        });
        if (highestBuy !== undefined) { this.remove("BUY", highestBuy); }
        if (lowestSell !== undefined) { this.remove("SELL", lowestSell); }
    }

    public merge(asks: BoardOrder[], bids: BoardOrder[]): Board {
        const asksToRemove = new Set(asks.map((ask) => ask.price));
        const asksToAppend = asks.filter((ask) => ask.size !== 0.0).map((ask) => new BoardOrder(ask));
        const bidsToRemove = new Set(bids.map((bid) => bid.price));
        const bidsToAppend = bids.filter((bid) => bid.size !== 0.0).map((bid) => new BoardOrder(bid));

        this.asks = this.asks
            .filter((ask) => !asksToRemove.has(ask.price))
            .concat(asksToAppend)
            .sort(ascendingPrice);

        this.bids = this.bids
            .filter((bid) => !bidsToRemove.has(bid.price))
            .concat(bidsToAppend)
            .sort(descendingPrice);

        return this;
    }

    public groupedAsks(groupPrice: number): BoardOrder[] {
        return this.groupBy(this.asks, groupPrice, 1, ceilBy);
    }

    public groupedBids(groupPrice: number): BoardOrder[] {
        return this.groupBy(this.bids, groupPrice, -1, floorBy);
    }

    private groupBy(
        orders: BoardOrder[],
        groupPrice: number,
        direction: number,
        roundPrice: (price: number, size: number) => number,
    ): BoardOrder[] {
        if (orders.length === 0) { return []; }
        if (groupPrice >= 100) {
            const best = orders.reduce((price, order) =>
                direction * order.price < direction * price ? order.price : price, orders[0].price);
            return this.groupWindow(orders, roundPrice(best, groupPrice), direction * groupPrice, roundPrice);
        }

        const sizes = new Map<number, number>();
        for (const order of orders) {
            const price = roundPrice(order.price, groupPrice);
            if (sizes.size === visibleRows && !sizes.has(price)) { break; }
            sizes.set(price, (sizes.get(price) || 0) + order.size);
        }
        return Array.from(sizes, ([price, size]) => new BoardOrder({ price, size }));
    }

    private groupWindow(
        orders: BoardOrder[],
        best: number,
        step: number,
        roundPrice: (price: number, size: number) => number,
    ): BoardOrder[] {
        const sizes: number[] = [];
        let rows = 0;
        orders.forEach((order) => {
            const index = Math.round((roundPrice(order.price, Math.abs(step)) - best) / step);
            rows = Math.max(rows, Math.min(index + 1, visibleRows));
            if (index < visibleRows) { sizes[index] = (sizes[index] || 0) + order.size; }
        });
        return Array.from({ length: rows }, (_, index) =>
            new BoardOrder({ price: best + index * step, size: sizes[index] || 0 }));
    }
}
