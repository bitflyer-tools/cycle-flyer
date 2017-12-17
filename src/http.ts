import hash = require('hash.js');
import {RequestInput} from '@cycle/http';

export const getBoard = (): RequestInput =>
    requestInput("board", "/v1/getboard", "GET");

export const getState = (): RequestInput =>
    requestInput("status", "/v1/getboardstate", "GET");

export const getCollateral = (): RequestInput =>
    requestInput("collateral", "/v1/me/getcollateral", "GET");

export const getPositions = (): RequestInput =>
    requestInput("positions", "/v1/me/getpositions", "GET");

export const marketOrder = (size: number, side: string): RequestInput => {
    const json = {
        "product_code": "FX_BTC_JPY",
        "child_order_type": "MARKET",
        "side": side,
        "size": Math.abs(size)
    };
    return requestInput("market-order", "/v1/me/sendchildorder", "POST", json);
};

export const limitOrder = (price: number, size: number, side: string): RequestInput => {
    const json = {
        "product_code": "FX_BTC_JPY",
        "child_order_type": "LIMIT",
        "side": side,
        "price": price,
        "size": Math.abs(size)
    };
    return requestInput("limit-order", "/v1/me/sendchildorder", "POST", json);
};

export const cancelOrders = (): RequestInput =>
    requestInput("cancelOrders", "/v1/me/cancelallchildorders", "POST", { "product_code": "FX_BTC_JPY" });

const requestInput = (category: string, path: string, method: string, json?: object) => {
    const [key, secret] = getApiKeys();

    const url = `https://api.bitflyer.jp${path}`;
    const query = { product_code: "FX_BTC_JPY" };
    const queryString = `?product_code=FX_BTC_JPY`;

    const send = json ? JSON.stringify(json) : "";
    const timestamp = Date.now().toString();

    const headers = {
        "ACCESS-KEY": key,
        "ACCESS-TIMESTAMP": timestamp,
        "ACCESS-SIGN": signature(key, secret, url, method, timestamp, send, path, queryString),
        "Content-Type": "application/json"
    };

    return { category, url, method, headers, send, query };
};

const getApiKeys = (): string[] => {
    return [localStorage["api-key"], localStorage["api-secret"]];
};

const signature = (
    key: string,
    secret: string,
    url: string,
    method: string,
    timestamp: string,
    send: string,
    path: string,
    query: string
): string => {
    const text = timestamp + method + path + query + send;
    return hash.hmac(hash.sha256, secret).update(text).digest('hex');
};
