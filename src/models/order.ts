export class Order {
    public price: number;
    public side: string;
    public size: number;

    constructor(json: object) {
        this.price = json.price;
        this.side = json.side;
        this.size = json.size;
    }
    
    public flooredPrice(size: number) {
        return Math.floor(this.price / size) * size;
    }

    public ceiledPrice(size: number) {
        return Math.ceil((this.price + size) / size) * size;
    }
}
