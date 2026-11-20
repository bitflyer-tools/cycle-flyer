export class Position {

    private static round(n: number): number {
        return Math.round(n * 100000000) / 100000000;
    }
    public side: string;
    public size: number;
    public price: number;

    constructor(positions: any[]) {
        if (!positions || positions.length === 0) {
            this.side = "";
            this.size = 0;
            this.price = 0;
            return;
        }

        const size = positions.reduce((acc, position) => acc + position.size, 0.0);
        const priceSum = positions.reduce((acc, position) => acc +  position.price * position.size, 0.0);

        this.side = positions[0].side;
        this.size = Position.round(size * (this.side === "BUY" ? 1 : -1));
        this.price = priceSum / size;
    }

    public profit(currentPrice: number): number {
        const profit = Math.floor(Position.round((currentPrice - this.price) * this.size));
        return profit === 0 ? 0 : profit;
    }

    public get displayPrice(): number {
        return Math.floor(Position.round(this.price));
    }

    public toPriceString(): string {
        if (this.price === 0) { return "None"; }
        return this.displayPrice.toLocaleString();
    }
    public toSizeString(): string {
        if (this.size === 0) { return "None"; }
        return this.size.toString();
    }

    public toDiffString(currentPrice: number): string {
        if (this.price === 0) { return "None"; }
        return (currentPrice - this.displayPrice).toLocaleString().replace("-", "- ");
    }
}
