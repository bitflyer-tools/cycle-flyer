import {RequestInput} from "@cycle/http";
import Stream from "xstream";
import hash = require('hash.js');
import {Actions} from "./intent";

export const request = (actions: Actions): Stream<RequestInput> => {
    return Stream.combine(
        actions.onApiKeyLoaded$,
        actions.onApiSecretLoaded$
    ).map(([key, secret]) => {
        const collateral = Stream.periodic(5000)
            .mapTo(input(key, secret, "collateral", "/v1/me/getcollateral", "GET"));

        const positions = Stream.periodic(5000)
            .mapTo(input(key, secret, "positions", "/v1/me/getpositions", "GET"));

        return Stream.merge(collateral, positions);
    }).flatten();
};

const input = (key: string, secret: string, category: string, path: string, method: string, json?: object) => {
    const url = `https://api.bitflyer.jp${path}`;
    const query = { product_code: "FX_BTC_JPY" };
    const queryString = `?product_code=FX_BTC_JPY`;

    const send = json ? JSON.stringify(json) : "";
    const timestamp = Date.now().toString();

    const headers = {
        "ACCESS-KEY": key,
        "ACCESS-TIMESTAMP": timestamp,
        "ACCESS-SIGN": signature(key, secret, url, method, timestamp, send, path, queryString)
    };

    return { category, url, method, headers, send, query };
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
