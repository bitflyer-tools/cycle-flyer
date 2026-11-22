import {ceilBy, floorBy} from "../util";
import {BoardOrder} from "./boardOrder";
import {Execution, executionPriceLimits} from "./execution";

const visibleRows = 200;
const ascendingPrice = (a: BoardOrder, b: BoardOrder): number => a.price - b.price;
const descendingPrice = (a: BoardOrder, b: BoardOrder): number => b.price - a.price;

export interface BoardLevels {
    asks: BoardOrder[];
    bids: BoardOrder[];
}

export class Board {
    public asks: BoardOrder[];
    public bids: BoardOrder[];

    constructor(json: BoardLevels) {
        this.asks = json.asks.map((ask) => new BoardOrder(ask)).sort(ascendingPrice);
        this.bids = json.bids.map((bid) => new BoardOrder(bid)).sort(descendingPrice);
    }

    public spread(): number {
        const upper = (this.asks[0] || { price: 0 }).price;
        const lower = (this.bids[0] || { price: 0 }).price;
        return upper - lower;
    }

    public remove(side: string, price: number) {
        if (side === "BUY") {
            if (this.asks.length === 0 || this.asks[0].price >= price) { return; }
            this.asks = this.asks.filter((ask) => ask.price >= price);
        } else {
            if (this.bids.length === 0 || this.bids[0].price <= price) { return; }
            this.bids = this.bids.filter((bid) => bid.price <= price);
        }
    }

    public removeExecutions(executions: Execution[]): void {
        const { highestBuy, lowestSell } = executionPriceLimits(executions);
        if (highestBuy !== undefined) { this.remove("BUY", highestBuy); }
        if (lowestSell !== undefined) { this.remove("SELL", lowestSell); }
    }

    public merge(asks: BoardOrder[], bids: BoardOrder[]): Board {
        this.asks = this.mergeSide(this.asks, asks, ascendingPrice);
        this.bids = this.mergeSide(this.bids, bids, descendingPrice);
        return this;
    }

    public groupedAsks(groupPrice: number): BoardOrder[] {
        return this.groupBy(this.asks, groupPrice, 1, ceilBy);
    }

    public groupedBids(groupPrice: number): BoardOrder[] {
        return this.groupBy(this.bids, groupPrice, -1, floorBy);
    }

    private mergeSide(
        orders: BoardOrder[],
        updates: BoardOrder[],
        compare: (a: BoardOrder, b: BoardOrder) => number,
    ): BoardOrder[] {
        if (updates.length === 0) { return orders; }
        if (updates.length === 1 && updates[0].size !== 0
            && this.replaceExistingLevel(orders, updates[0], compare)) { return orders; }
        const pricesToRemove = new Set(updates.map((order) => order.price));
        const changedOrders = updates.filter((order) => order.size !== 0).map((order) => new BoardOrder(order));
        if (changedOrders.length > 1) { changedOrders.sort(compare); }

        const merged: BoardOrder[] = [];
        let next = 0;
        for (const order of orders) {
            if (pricesToRemove.has(order.price)) { continue; }
            while (next < changedOrders.length && compare(changedOrders[next], order) < 0) {
                merged.push(changedOrders[next++]);
            }
            merged.push(order);
        }
        while (next < changedOrders.length) { merged.push(changedOrders[next++]); }
        return merged;
    }

    private replaceExistingLevel(
        orders: BoardOrder[],
        update: BoardOrder,
        compare: (a: BoardOrder, b: BoardOrder) => number,
    ): boolean {
        let low = 0;
        let high = orders.length;
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (compare(orders[middle], update) < 0) { low = middle + 1; } else { high = middle; }
        }

        if (orders[low]?.price !== update.price || orders[low + 1]?.price === update.price) { return false; }
        orders[low] = new BoardOrder(update);
        return true;
    }

    private groupBy(
        orders: BoardOrder[],
        groupPrice: number,
        direction: number,
        roundPrice: (price: number, size: number) => number,
    ): BoardOrder[] {
        if (orders.length === 0) { return []; }
        if (groupPrice >= 100) {
            const best = roundPrice(orders[0].price, groupPrice);
            return this.groupWindow(orders, best, direction * groupPrice, roundPrice);
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
        for (const order of orders) {
            const index = Math.round((roundPrice(order.price, Math.abs(step)) - best) / step);
            rows = Math.max(rows, Math.min(index + 1, visibleRows));
            if (index >= visibleRows) { break; }
            sizes[index] = (sizes[index] || 0) + order.size;
        }
        return Array.from({ length: rows }, (_, index) =>
            new BoardOrder({ price: best + index * step, size: sizes[index] || 0 }));
    }
}

export const isBoardLevels = (value: unknown): value is BoardLevels =>
    typeof value === "object" && value !== null
    && "asks" in value && isBoardSide(value.asks)
    && "bids" in value && isBoardSide(value.bids);

const isBoardSide = (orders: unknown): boolean =>
    Array.isArray(orders) && orders.every((order) =>
        Number.isFinite(order?.price) && Number.isFinite(order?.size));
