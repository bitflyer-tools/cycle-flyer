import {ceilBy, floorBy} from "../util";

export class Board {
    public asks: BoardOrder[];
    public bids: BoardOrder[];

    constructor(json: object) {
        this.asks = json.asks.map(ask => new BoardOrder(ask));
        this.bids = json.bids.map(bid => new BoardOrder(bid));
    }

    public spread(): number {
        const upper = (this.asks[0] || { price: 0 }).price;
        const lower = (this.bids[0] || { price: 0 }).price;
        return upper - lower;
    }

    public remove(side: string, price: number) {
        if (side === "BUY") {
            this.asks = this.asks.filter(ask => ask.price >= price);
        } else {
            this.bids = this.bids.filter(bid => bid.price <= price);
        }
    }

    public merge(asks: BoardOrder[], bids: BoardOrder[]): Board {
        const asksToRemove = asks.map(ask => ask.price);
        const asksToAppend = asks.filter(ask => ask.size != 0.0).map(ask => new BoardOrder(ask));
        const bidsToRemove = bids.map(bid => bid.price);
        const bidsToAppend = bids.filter(bid => bid.size != 0.0).map(bid => new BoardOrder(bid));

        this.asks = this.asks
            .filter(ask => !asksToRemove.reduce((previous: boolean, price: number) => previous || price === ask.price, false))
            .concat(asksToAppend)
            .sort((a, b) => a.price < b.price ? -1 : 1);

        this.bids = this.bids
            .filter(bid => !bidsToRemove.reduce((previous: boolean, price: number) => previous || price === bid.price, false))
            .concat(bidsToAppend)
            .sort((a, b) => a.price > b.price ? -1 : 1);

        return this;
    }

    public groupedAsks(groupPrice: number): BoardOrder[] {
        return this.ceilBySize(this.asks, groupPrice).sort((a, b) => a.price < b.price ? -1 : 1);
    }

    public groupedBids(groupPrice: number): BoardOrder[] {
        return this.floorBySize(this.bids, groupPrice).sort((a, b) => a.price > b.price ? -1 : 1);
    }

    private floorBySize(boardOrders: BoardOrder[], priceSize: number): BoardOrder[] {
        return this.groupBy(boardOrders, priceSize, order => floorBy(order.price, priceSize));
    }

    private ceilBySize(boardOrders: BoardOrder[], priceSize: number): BoardOrder[] {
        return this.groupBy(boardOrders, priceSize, order => ceilBy(order.price, priceSize));
    }

    private groupBy(boardOrders: BoardOrder[], priceSize: number, fn: (order: BoardOrder) => number): BoardOrder[] {
        const prices = boardOrders.reduce((acc: object, boardOrder: BoardOrder) => {
            const price = fn(boardOrder);
            acc[price] = (acc[price] || 0) + boardOrder.size;
            return acc;
        }, []);
        return this.mapToBoardOrder(priceSize, prices);
    }

    private mapToBoardOrder(priceSize: number, prices: object): BoardOrder[] {
        if (priceSize > 99 && Object.keys(prices).length > 0) {
            const min = Math.min.apply(null, Object.keys(prices));
            const max = Math.max.apply(null, Object.keys(prices));
            const keys = Array((max - min) / priceSize).fill(priceSize).map((value, index) => min + index * value);
            return keys.map(key => new BoardOrder({ price: +key, size: +(prices[key] || 0) }));
        }

        return Object.keys(prices).map(key => new BoardOrder({ price: +key, size: +prices[key] }));
    }
}

export class BoardOrder {
    public price: number;
    public size: number;

    constructor(json: object) {
        this.price = json.price;
        this.size = json.size;
    }
}
