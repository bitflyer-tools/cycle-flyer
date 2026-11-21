import Stream from "xstream";

export const credentialChanges$ = Stream.create<symbol>();

let key: string | undefined;
let secret: string | undefined;
// A new version also distinguishes switching away from a pair and back to it.
let version = Symbol();

export const apiCredentials = () => {
    const storage = typeof localStorage === "undefined" ? undefined : localStorage;
    const nextKey = storage?.["api-key"];
    const nextSecret = storage?.["api-secret"];
    if (key !== nextKey || secret !== nextSecret) {
        key = nextKey;
        secret = nextSecret;
        version = Symbol();
        credentialChanges$.shamefullySendNext(version);
    }
    return { key, secret, version };
};
