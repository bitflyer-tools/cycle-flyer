import * as hash from "hash.js";
import Stream from "xstream";

interface CredentialPair {
    key: string;
    secret: string;
}

interface RealtimeAuth {
    api_key: string;
    nonce: string;
    signature: string;
    timestamp: number;
}

interface CredentialBridge {
    migrate(pair: CredentialPair): Promise<void>;
    save(pair: CredentialPair | null): Promise<void>;
    signRest(method: string, path: string, body: string): Promise<Record<string, string> | null>;
    signRealtime(): Promise<RealtimeAuth | null>;
}

export const credentialsChanged$ = Stream.create<void>();

const bridge = (window as Window & { bitFlyerCredentials?: CredentialBridge }).bitFlyerCredentials;
let sessionPair: CredentialPair | null = null;
let migration: Promise<boolean> | undefined;

export const initializeCredentials = (): Promise<boolean> => {
    if (!migration) {
        migration = migrateLegacyCredentials().then(() => true, () => false);
    }
    return migration;
};

export const saveCredentials = async (pair: CredentialPair | null): Promise<void> => {
    await initializeCredentials();
    if (bridge) {
        await bridge.save(pair);
    } else {
        sessionPair = pair;
    }
    migration = Promise.resolve(true);
    credentialsChanged$.shamefullySendNext(undefined);
};

export const signRest = async (method: string, path: string, body: string) => {
    await initializeCredentials();
    if (bridge) { return bridge.signRest(method, path, body); }
    if (!sessionPair) { return null; }

    const timestamp = Date.now().toString();
    return {
        "ACCESS-KEY": sessionPair.key,
        "ACCESS-SIGN": signature(sessionPair.secret, timestamp + method + path + body),
        "ACCESS-TIMESTAMP": timestamp,
    };
};

export const signRealtime = async (): Promise<RealtimeAuth | null> => {
    await initializeCredentials();
    if (bridge) { return bridge.signRealtime(); }
    if (!sessionPair) { return null; }

    const timestamp = Date.now();
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map((byte) => ("0" + byte.toString(16)).slice(-2))
        .join("");
    return {
        api_key: sessionPair.key,
        nonce,
        signature: signature(sessionPair.secret, `${timestamp}${nonce}`),
        timestamp,
    };
};

const migrateLegacyCredentials = async (): Promise<void> => {
    const key = localStorage.getItem("api-key");
    const secret = localStorage.getItem("api-secret");
    localStorage.removeItem("api-key");
    localStorage.removeItem("api-secret");
    if (!key || !secret) { return; }

    if (bridge) {
        await bridge.migrate({ key, secret });
    } else {
        sessionPair = { key, secret };
    }
};

const signature = (secret: string, message: string): string =>
    hash.hmac((hash as any).sha256, secret).update(message).digest("hex");
