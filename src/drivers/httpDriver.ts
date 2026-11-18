import {makeHTTPDriver, RequestInput} from "@cycle/http";
import Stream from "xstream";
import flattenConcurrently from "xstream/extra/flattenConcurrently";
import {signRest, twapCredentialVersion} from "../credentials";
import {TwapSliceRequest} from "../http";

export const unsignedRequests$ = Stream.create<RequestInput>();

export const makeSignedHTTPDriver = () => {
    const driver = makeHTTPDriver();
    return (requests$: Stream<RequestInput | null>) => driver(
        requests$
            .map((request) => Stream.fromPromise(authorizeRequest(request).then((authorized) => {
                if (request && !authorized) { unsignedRequests$.shamefullySendNext(request); }
                return authorized;
            })))
            .compose(flattenConcurrently)
            .filter((request): request is RequestInput => request !== null),
    );
};

export const authorizeRequest = async (request: RequestInput | null): Promise<RequestInput | null> => {
    const origin = "https://api.bitflyer.jp";
    if (!request || typeof request === "string" || !request.url.startsWith(origin + "/v1/me/")) {
        return request;
    }

    const {isTwapActive, onSigningFailure} = request as TwapSliceRequest;
    const isTwap = request.category === "twap-order";
    const version = twapCredentialVersion();
    const cancelled = () => isTwap &&
        (version === null || version !== twapCredentialVersion() || isTwapActive?.() === false);
    if (cancelled()) { return null; }

    try {
        const body = request.send || "";
        const headers = typeof body === "string"
            ? await signRest(request.method || "GET", request.url.slice(origin.length), body)
            : null;
        if (!cancelled() && headers) {
            return { ...request, headers: Object.assign({}, request.headers, headers) };
        }
    } catch {
        // eslint-disable-next-line no-console
        console.error("Unable to sign the bitFlyer request.");
    }
    if (!cancelled()) { onSigningFailure?.(); }
    return null;
};
