import {Board, BoardLevels} from "./board";
import {BoardOrder} from "./boardOrder";
import {Execution, executionPriceLimits} from "./execution";

export class BoardSnapshot {
    private asks: SnapshotSide;
    private bids: SnapshotSide;

    constructor(levels: BoardLevels) {
        this.asks = new SnapshotSide(levels.asks, Math.min, Infinity);
        this.bids = new SnapshotSide(levels.bids, Math.max, -Infinity);
    }

    public merge(asks: BoardOrder[], bids: BoardOrder[]): void {
        this.asks.merge(asks);
        this.bids.merge(bids);
    }

    public removeExecutions(executions: Execution[]): void {
        const { highestBuy, lowestSell } = executionPriceLimits(executions);
        if (highestBuy !== undefined) {
            this.asks.prune((price) => price >= highestBuy);
        }
        if (lowestSell !== undefined) {
            this.bids.prune((price) => price <= lowestSell);
        }
    }

    public toBoard(): Board {
        return new Board({ asks: this.asks.materialize(), bids: this.bids.materialize() });
    }
}

class SnapshotSide {
    private levels = new Map<number, BoardOrder[]>();
    private bestPrice: number;

    constructor(
        orders: BoardOrder[],
        private betterPrice: (a: number, b: number) => number,
        private emptyPrice: number,
    ) {
        this.bestPrice = emptyPrice;
        orders.forEach((order) => this.append(order));
    }

    public merge(updates: BoardOrder[]): void {
        if (updates.length === 0) { return; }
        updates.forEach(({ price }) => this.levels.delete(price));
        updates.forEach((order) => {
            if (order.size !== 0) { this.append(order); }
        });
        if (!this.levels.has(this.bestPrice)) {
            this.bestPrice = this.emptyPrice;
            this.levels.forEach((_, price) => { this.recordPrice(price); });
        }
    }

    public prune(keep: (price: number) => boolean): void {
        if (keep(this.bestPrice)) { return; }
        this.bestPrice = this.emptyPrice;
        this.levels.forEach((_, price) => {
            if (keep(price)) {
                this.recordPrice(price);
            } else {
                this.levels.delete(price);
            }
        });
    }

    public materialize(): BoardOrder[] {
        const orders: BoardOrder[] = [];
        this.levels.forEach((levels) => levels.forEach((order) => orders.push(order)));
        return orders;
    }

    private append(order: BoardOrder): void {
        const { price } = order;
        const levels = this.levels.get(price);
        if (levels) {
            levels.push(order);
        } else {
            this.levels.set(price, [order]);
            this.recordPrice(price);
        }
    }

    private recordPrice(price: number): void {
        this.bestPrice = this.betterPrice(this.bestPrice, price);
    }
}
