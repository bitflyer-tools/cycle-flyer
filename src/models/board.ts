export class Board {
    public asks: BoardOrder[];
    public bids: BoardOrder[];

    constructor(json: object) {
        this.asks = json.asks;
        this.bids = json.bids;
    }

    public spread(): number {
        const upper = (this.asks[0] || { price: 0 }).price;
        const lower = (this.bids[0] || { price: 0 }).price;
        return upper - lower;
    }

    public remove(side: string, price: number) {
        if (side === "BUY") {
            this.asks = this.asks.filter(ask => ask.price > price);
        } else {
            this.bids = this.bids.filter(bid => bid.price < price);
        }
    }
}

export interface BoardOrder {
    price: number;
    size: number;
}
