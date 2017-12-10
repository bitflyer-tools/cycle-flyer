export class Position {
    public side: string;
    public size: number;
    public price: number;

    constructor(positions: object[]) {
        if (!positions || positions.length === 0) {
            this.side = "";
            this.size = 0;
            this.price = 0;
            return
        }

        const size = positions.reduce((acc, position) => acc + position.size, 0.0);
        const priceSum = positions.reduce((acc, position) => acc +  position.price * position.size, 0.0);

        this.side = positions[0].side;
        this.size = Position.round(size * (this.side === "BUY" ? 1 : -1));
        this.price = Math.floor(Position.round(priceSum / size));
    }

    public profit(currentPrice: number): number {
        return Math.floor(Position.round((currentPrice - this.price) * this.size));
    }

    public toString(): string {
        if (this.price === 0) return "None";
        return `${this.price.toLocaleString()} / ${this.size}`
    };

    public toDiffString(currentPrice: number): string {
        if (this.price === 0) return "None";
        return (currentPrice - this.price).toLocaleString();
    };

    public toProfitString(currentPrice: number): string {
        if (this.price === 0) return "None";
        return this.profit(currentPrice).toLocaleString();
    };

    private static round(number: number): number {
        return Math.round(number * 100000000) / 100000000;
    }
}
