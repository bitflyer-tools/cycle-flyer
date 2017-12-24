export interface OrderHistory {
    createdAt: Date;
    description: string;
    name: string;
    status: string;
}

export const createOrderHistory = (
    name: string,
    side: string,
    size: number,
    price: number,
    status: string
): OrderHistory => ({
    createdAt: new Date(),
    description: `${side} / ${size} / ${(price && price.toLocaleString()) || "MARKET"}`,
    name: name,
    status: status
});
