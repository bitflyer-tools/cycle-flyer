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
    hasCredentials(): Promise<boolean>;
    migrate(pair: CredentialPair): Promise<boolean>;
    save(pair: CredentialPair | null): Promise<void>;
    signRest(method: string, path: string, body: string): Promise<Record<string, string> | null>;
    signRealtime(): Promise<RealtimeAuth | null>;
}

export const credentialsChanged$ = Stream.create<void>();
export const credentialsChanging$ = Stream.create<void>();

const bridge = (typeof window === "undefined" ? undefined :
    (window as Window & { bitFlyerCredentials?: CredentialBridge }).bitFlyerCredentials);
const reentryRequiredKey = "bitflyer-credentials-reentry-required";
let sessionPair: CredentialPair | null = null;
let migration: Promise<boolean> | undefined;
let credentialVersion = 0;
let pendingSaves = 0;
let ready = false;
const readiness$ = Stream.create<boolean>();

export const canSignTwap = (): boolean => pendingSaves === 0 && ready;

export const twapCredentialAvailability = (): Stream<boolean> =>
    readiness$.startWith(canSignTwap());

export const currentCredentialVersion = (): number | null =>
    pendingSaves === 0 ? credentialVersion : null;

export const initializeCredentials = (): Promise<boolean> => {
    if (!migration) {
        migration = migrateLegacyCredentials().catch(() => false);
        void migration.then(() => refreshReadiness(0));
    }
    return migration;
};

export const saveCredentials = async (pair: CredentialPair | null): Promise<void> => {
    credentialVersion += 1;
    pendingSaves += 1;
    ready = false;
    try {
        readiness$.shamefullySendNext(false);
        credentialsChanging$.shamefullySendNext(undefined);
        await initializeCredentials();
        if (bridge) {
            await bridge.save(pair);
            removeLegacyCredentials();
            localStorage.removeItem(reentryRequiredKey);
        } else {
            sessionPair = pair;
        }
        migration = Promise.resolve(true);
    } finally {
        pendingSaves -= 1;
        const version = credentialVersion;
        await refreshReadiness(version);
        if (version === currentCredentialVersion()) { credentialsChanged$.shamefullySendNext(undefined); }
    }
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

const refreshReadiness = async (version: number): Promise<void> => {
    if (pendingSaves || version !== credentialVersion) { return; }
    let available = !!sessionPair;
    if (bridge) {
        try {
            available = await bridge.hasCredentials();
        } catch {
            available = false;
        }
    }
    if (pendingSaves || version !== credentialVersion) { return; }
    ready = available;
    readiness$.shamefullySendNext(ready);
};

const migrateLegacyCredentials = async (): Promise<boolean> => {
    const key = localStorage.getItem("api-key");
    const secret = localStorage.getItem("api-secret");
    if (bridge && localStorage.getItem(reentryRequiredKey)) {
        removeLegacyCredentials();
        return false;
    }
    if (key && secret) {
        if (!bridge) {
            sessionPair = { key, secret };
        } else if (!await bridge.migrate({ key, secret })) {
            localStorage.setItem(reentryRequiredKey, "true");
            removeLegacyCredentials();
            return false;
        }
    }
    removeLegacyCredentials();
    return true;
};

const removeLegacyCredentials = (): void => {
    localStorage.removeItem("api-key");
    localStorage.removeItem("api-secret");
};

const signature = (secret: string, message: string): string =>
    hash.hmac((hash as any).sha256, secret).update(message).digest("hex");
