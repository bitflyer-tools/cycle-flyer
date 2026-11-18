import {makeHTTPDriver, RequestInput} from "@cycle/http";
import Stream from "xstream";
import flattenConcurrently from "xstream/extra/flattenConcurrently";
import {signRest} from "../credentials";

export const makeSignedHTTPDriver = () => {
    const driver = makeHTTPDriver();
    return (requests$: Stream<RequestInput | null>) => driver(
        requests$
            .map((request) => Stream.fromPromise(authorizeRequest(request)))
            .compose(flattenConcurrently)
            .filter((request): request is RequestInput => request !== null),
    );
};

export const authorizeRequest = async (request: RequestInput | null): Promise<RequestInput | null> => {
    const origin = "https://api.bitflyer.jp";
    if (!request || typeof request === "string" || !request.url.startsWith(origin + "/v1/me/")) {
        return request;
    }

    try {
        const body = request.send || "";
        if (typeof body !== "string") { return null; }
        const headers = await signRest(request.method || "GET", request.url.slice(origin.length), body);
        return headers ? { ...request, headers: Object.assign({}, request.headers, headers) } : null;
    } catch {
        // eslint-disable-next-line no-console
        console.error("Unable to sign the bitFlyer request.");
        return null;
    }
};
