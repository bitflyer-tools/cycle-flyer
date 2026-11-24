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

export type AccountType = "corporate" | "individual";

export const defaultAccountType: AccountType = "individual";

export const accountTypeStorageKey = "account-type";

// https://bitflyer.com/ja-jp/faq/4-27
export const maximumOrderSizeByAccountType: Record<AccountType, number> = {
    corporate: 40,
    individual: 10,
};

export const minimumOrderSize = 0.001;

export const isValidOrderSize = (size: number, accountType: AccountType = defaultAccountType): boolean =>
    Number.isFinite(size)
    && size >= minimumOrderSize
    && size <= maximumOrderSizeByAccountType[accountType];
