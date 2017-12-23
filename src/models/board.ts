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
        return this.groupBy(boardOrders, order => order.flooredPrice(priceSize));
    }

    private ceilBySize(boardOrders: BoardOrder[], priceSize: number): BoardOrder[] {
        return this.groupBy(boardOrders, order => order.ceiledPrice(priceSize));
    }

    private groupBy(boardOrders: BoardOrder[], fn: (order: BoardOrder) => number): BoardOrder[] {
        const map = boardOrders.reduce((acc: object, boardOrder: BoardOrder) => {
            const price = fn(boardOrder);
            acc[price] = (acc[price] || 0) + boardOrder.size;
            return acc;
        }, []);
        return Object.keys(map).map(key => new BoardOrder({ price: +key, size: +map[key] }));
    }
}

export class BoardOrder {
    public price: number;
    public size: number;

    constructor(json: object) {
        this.price = json.price;
        this.size = json.size;
    }

    public flooredPrice(size: number) {
        return Math.floor(this.price / size) * size;
    }

    public ceiledPrice(size: number) {
        return Math.ceil((this.price + size) / size) * size;
    }
}
