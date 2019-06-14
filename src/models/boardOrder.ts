export class BoardOrder {
    public price: number;
    public size: number;

    constructor(json: any) {
        this.price = json.price;
        this.size = json.size;
    }
}
