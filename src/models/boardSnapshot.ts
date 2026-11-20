import {Board, BoardLevels} from "./board";
import {BoardOrder} from "./boardOrder";
import {Execution, executionPriceLimits} from "./execution";

export class BoardSnapshot {
    private asks: Map<number, BoardOrder[]>;
    private bids: Map<number, BoardOrder[]>;

    constructor(levels: BoardLevels) {
        this.asks = indexSide(levels.asks);
        this.bids = indexSide(levels.bids);
    }

    public merge(asks: BoardOrder[], bids: BoardOrder[]): void {
        mergeSide(this.asks, asks);
        mergeSide(this.bids, bids);
    }

    public removeExecutions(executions: Execution[]): void {
        const { highestBuy, lowestSell } = executionPriceLimits(executions);
        if (highestBuy !== undefined) {
            pruneSide(this.asks, (price) => price >= highestBuy);
        }
        if (lowestSell !== undefined) {
            pruneSide(this.bids, (price) => price <= lowestSell);
        }
    }

    public toBoard(): Board {
        return new Board({ asks: materializeSide(this.asks), bids: materializeSide(this.bids) });
    }
}

const indexSide = (orders: BoardOrder[]): Map<number, BoardOrder[]> => {
    const side = new Map<number, BoardOrder[]>();
    orders.forEach((order) => appendOrder(side, order));
    return side;
};

const appendOrder = (side: Map<number, BoardOrder[]>, order: BoardOrder): void => {
    const levels = side.get(order.price);
    if (levels) {
        levels.push(order);
    } else {
        side.set(order.price, [order]);
    }
};

const mergeSide = (side: Map<number, BoardOrder[]>, updates: BoardOrder[]): void => {
    updates.forEach(({ price }) => side.delete(price));
    updates.forEach((order) => {
        if (order.size !== 0) { appendOrder(side, order); }
    });
};

const pruneSide = (side: Map<number, BoardOrder[]>, keep: (price: number) => boolean): void => {
    side.forEach((_, price) => {
        if (!keep(price)) { side.delete(price); }
    });
};

const materializeSide = (side: Map<number, BoardOrder[]>): BoardOrder[] => {
    const orders: BoardOrder[] = [];
    side.forEach((levels) => levels.forEach((order) => orders.push(order)));
    return orders;
};
