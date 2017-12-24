export class Order {
    public price: number;
    public side: string;
    public size: number;

    constructor(json: object) {
        this.price = json.price;
        this.side = json.side;
        this.size = json.size;
    }
}
