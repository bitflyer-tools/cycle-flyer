export class IFDOCOrder {
    public width: number;
    public ratio: number;

    constructor(width: number, ratio: number) {
        this.width = width;
        if (ratio > 100) {
            this.ratio = 100
        } else if (ratio < 0) {
            this.ratio = 0
        } else {
            this.ratio = ratio;
        }
    }

    public buyProfitLine(currentPrice: number): number {
        return currentPrice + this.width * this.ratio / 100
    }

    public buyLossLine(currentPrice: number): number {
        return currentPrice - this.width * (100 - this.ratio) / 100
    }

    public sellProfitLine(currentPrice: number): number {
        return currentPrice - this.width * this.ratio / 100
    }

    public sellLossLine(currentPrice: number): number {
        return currentPrice + this.width * (100 - this.ratio) / 100
    }

    public buyProfit(currentPrice: number, size: number): number {
        return (this.buyProfitLine(currentPrice) - currentPrice) * size
    }

    public buyLoss(currentPrice: number, size: number): number {
        return (this.buyLossLine(currentPrice) - currentPrice) * size * -1
    }

    public sellProfit(currentPrice: number, size: number): number {
        return (currentPrice - this.sellProfitLine(currentPrice)) * size
    }

    public sellLoss(currentPrice: number, size: number): number {
        return (currentPrice - this.sellLossLine(currentPrice)) * size * -1
    }
}
