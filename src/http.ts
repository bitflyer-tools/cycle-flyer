import {RequestInput, RequestOptions} from "@cycle/http";
import {hasApiCredentials} from "./credentials";

export const getBoard = (): RequestInput =>
    ({ ...requestInput("board", "/v1/getboard", "GET"), lazy: true });

export const getState = (): RequestInput =>
    requestInput("status", "/v1/getboardstate", "GET");

export const getCollateral = (): RequestInput =>
    requestInput("collateral", "/v1/me/getcollateral", "GET");

export const getPositions = (): RequestInput =>
    requestInput("positions", "/v1/me/getpositions", "GET");

export const recentTradesLimit = 25;

export const getRecentTrades = (): RequestOptions =>
    requestInput("recent-trades", "/v1/executions", "GET", undefined, { count: recentTradesLimit });

export const executionPageSize = 50;

export const getExecutions = (before?: number): RequestOptions | null => {
    if (!hasApiCredentials()) { return null; }
    const page = { count: executionPageSize };
    return requestInput("executions", "/v1/me/getexecutions", "GET", undefined,
        before === undefined ? page : { ...page, before });
};

export const getOrders = (): RequestInput =>
    requestInput("orders", "/v1/me/getchildorders", "GET", undefined, { child_order_state: "ACTIVE" });

export const parentOrdersPageSize = 100;

export const getParentOrders = (before?: number): RequestOptions =>
    ({
        ...requestInput(before === undefined ? "parent-orders" : "parent-orders-page",
            "/v1/me/getparentorders", "GET", undefined, {
                parent_order_state: "ACTIVE",
                count: parentOrdersPageSize,
                ...(before === undefined ? {} : { before }),
            }),
        lazy: true,
    });

export const getParentOrder = (parentOrderId: string): RequestOptions =>
    requestInput("parent-order", "/v1/me/getparentorder", "GET", undefined, { parent_order_id: parentOrderId });

export const marketOrder = (size: number, side: string): RequestInput => {
    const json = {
        child_order_type: "MARKET",
        product_code: "FX_BTC_JPY",
        side,
        size: Math.abs(size),
    };
    return requestInput("market-order", "/v1/me/sendchildorder", "POST", json);
};

export interface TwapSliceRequest extends RequestOptions {
    isTwapActive?: () => boolean;
    onSigningFailure?: () => void;
    scheduleId: symbol;
}

export const twapSliceOrder = (size: number, side: string, scheduleId: symbol): TwapSliceRequest =>
    ({ ...(marketOrder(size, side) as RequestOptions), category: "twap-order", scheduleId });

export const limitOrder = (price: number, size: number, side: string): RequestInput => {
    const json = {
        child_order_type: "LIMIT",
        price,
        product_code: "FX_BTC_JPY",
        side,
        size: Math.abs(size),
    };
    return requestInput("limit-order", "/v1/me/sendchildorder", "POST", json);
};

export const ifdocoOrder = (profitLine: number, lossLine: number, size: number, side: string): RequestInput => {
    const json = {
        order_method: "IFDOCO",
        parameters: [
            {
                condition_type: "MARKET",
                product_code: "FX_BTC_JPY",
                side,
                size,
            },
            {
                condition_type: "LIMIT",
                price: profitLine,
                product_code: "FX_BTC_JPY",
                side: side === "BUY" ? "SELL" : "BUY",
                size,
            },
            {
                condition_type: "STOP",
                product_code: "FX_BTC_JPY",
                side: side === "BUY" ? "SELL" : "BUY",
                size,
                trigger_price: lossLine,
            },
        ],
        time_in_force: "GTC",
    };

    return requestInput("ifdoco-order", "/v1/me/sendparentorder", "POST", json);
};

export const stopOrder = (triggerPrice: number, size: number, side: string): RequestInput => {
    const json = {
        order_method: "SIMPLE",
        parameters: [
            {
                condition_type: "STOP",
                product_code: "FX_BTC_JPY",
                side,
                size: Math.abs(size),
                trigger_price: triggerPrice,
            },
        ],
        time_in_force: "GTC",
    };

    return requestInput("stop-order", "/v1/me/sendparentorder", "POST", json);
};

export const cancelOrders = (): RequestInput =>
    requestInput("cancel-orders", "/v1/me/cancelallchildorders", "POST", { product_code: "FX_BTC_JPY" });

export const cancelParentOrder = (parentOrderId: string): RequestInput =>
    requestInput("cancel-parent-order", "/v1/me/cancelparentorder", "POST", {
        parent_order_id: parentOrderId,
        product_code: "FX_BTC_JPY",
    });

const requestInput = (category: string, path: string, method: string, json?: object, q?: object) => {
    const query = { product_code: "FX_BTC_JPY", ...q } as Record<string, string | number>;
    const queryString = Object.keys(query)
        .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(query[key])}`)
        .join("&");
    const url = `https://api.bitflyer.jp${path}?${queryString}`;
    const send = json ? JSON.stringify(json) : "";
    const headers = { "Content-Type": "application/json" };
    return { category, url, method, headers, send };
};
