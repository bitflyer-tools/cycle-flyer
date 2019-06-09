import {RequestInput} from "@cycle/http";
import hash = require("hash.js");

export const getBoard = (): RequestInput =>
    requestInput("board", "/v1/getboard", "GET");

export const getState = (): RequestInput =>
    requestInput("status", "/v1/getboardstate", "GET");

export const getCollateral = (): RequestInput =>
    requestInput("collateral", "/v1/me/getcollateral", "GET");

export const getPositions = (): RequestInput =>
    requestInput("positions", "/v1/me/getpositions", "GET");

export const getOrders = (): RequestInput =>
    requestInput("orders", "/v1/me/getchildorders", "GET", undefined, { child_order_state: "ACTIVE" });

export const getParentOrders = (): RequestInput =>
    requestInput("parent-orders", "/v1/me/getparentorders", "GET", undefined, { parent_order_state: "ACTIVE" });

export const getParentOrder = (parentOrderId: number): RequestInput =>
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
                size: Math.abs(size),
            },
            {
                condition_type: "LIMIT",
                price: profitLine,
                product_code: "FX_BTC_JPY",
                side: side === "BUY" ? "SELL" : "BUY",
                size: Math.abs(size),
            },
            {
                condition_type: "STOP",
                product_code: "FX_BTC_JPY",
                side: side === "BUY" ? "SELL" : "BUY",
                size: Math.abs(size),
                trigger_price: lossLine,
            },
        ],
        time_in_force: "GTC",
    };

    return requestInput("ifdoco-order", "/v1/me/sendparentorder", "POST", json);
};

export const cancelOrders = (): RequestInput =>
    requestInput("cancel-orders", "/v1/me/cancelallchildorders", "POST", { product_code: "FX_BTC_JPY" });

const requestInput = (category: string, path: string, method: string, json?: object, q?: object) => {
    const [key, secret] = getApiKeys();

    const url = `https://api.bitflyer.jp${path}`;
    const query = { product_code: "FX_BTC_JPY", ...q };
    const queryString = "?" + Object.keys(query).reduce((acc, k) => acc + `&${k}=${query[k]}`, "").slice(1);

    const send = json ? JSON.stringify(json) : "";
    const timestamp = Date.now().toString();

    const headers = {
        "ACCESS-KEY": key,
        "ACCESS-SIGN": signature(method, path, queryString, secret, send, timestamp),
        "ACCESS-TIMESTAMP": timestamp,
        "Content-Type": "application/json",
    };

    return { category, url, method, headers, send, query };
};

const getApiKeys = (): string[] => {
    return [localStorage["api-key"], localStorage["api-secret"]];
};

const signature = (
    method: string,
    path: string,
    query: string,
    secret: string,
    send: string,
    timestamp: string,
): string => {
    const text = timestamp + method + path + query + send;
    return hash.hmac(hash.sha256, secret).update(text).digest("hex");
};
