export class StopOrder {
    public price: number;
    public side: string;
    public size: number;

    constructor(json: object) {
        this.price = json.price || json.trigger_price;
        this.side = json.side;
        this.size = json.size;
    }

    public isExcuted(currentPrice: number): boolean {
        if (this.side === "BUY") {
            return currentPrice <= this.price
        } else {
            return currentPrice >= this.price
        }
    }
}
