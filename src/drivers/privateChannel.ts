import * as hash from "hash.js";
import {Socket} from "socket.io-client";

export const privateChannelNames = ["child_order_events", "parent_order_events"];

export const authenticate = (client: Socket, onAuthenticated: () => void) => {
    const [apiKey, apiSecret] = [localStorage["api-key"], localStorage["api-secret"]];
    if (!apiKey || !apiSecret) { return; }

    client.emit("auth", authParams(apiKey, apiSecret), (error: any) => error || onAuthenticated());
};

const authParams = (apiKey: string, apiSecret: string) => {
    const timestamp = Date.now();
    const nonce = randomHex(16);
    const signature = hash.hmac((hash as any).sha256, apiSecret).update(`${timestamp}${nonce}`).digest("hex");
    return { api_key: apiKey, nonce, signature, timestamp };
};

const randomHex = (bytes: number): string =>
    Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
