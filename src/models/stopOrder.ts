export class StopOrder {
    public price: number;
    public side: string;
    public size: number;

    constructor(json: any) {
        this.price = json.trigger_price ?? json.price;
        this.side = json.side;
        this.size = json.size;
    }
}
