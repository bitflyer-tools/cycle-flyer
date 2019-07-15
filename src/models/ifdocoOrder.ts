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
        return currentPrice + this.profitDifference()
    }

    public buyLossLine(currentPrice: number): number {
        return currentPrice - this.lossDifference()
    }

    public sellProfitLine(currentPrice: number): number {
        return currentPrice - this.profitDifference()
    }

    public sellLossLine(currentPrice: number): number {
        return currentPrice + this.lossDifference()
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

    public profitDifference(): number {
        return this.width * this.ratio / 100
    }

    public lossDifference(): number {
        return this.width * (100 - this.ratio) / 100
    }
}
