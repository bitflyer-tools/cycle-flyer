export class Order {
    public price: number;
    public side: string;
    public size: number;

    constructor(json: any) {
        this.price = json.price;
        this.side = json.side;
        this.size = json.outstanding_size;
    }
}

export const minimumMarketOrderSize = 0.01;

export const isValidMarketOrderSize = (size: number): boolean =>
    Number.isFinite(size) && size >= minimumMarketOrderSize;
