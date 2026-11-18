import {makeHTTPDriver, RequestInput, RequestOptions} from "@cycle/http";
import Stream from "xstream";
import flattenConcurrently from "xstream/extra/flattenConcurrently";
import {currentCredentialVersion, signRest} from "../credentials";
import {TwapSliceRequest} from "../http";

export interface AccountRequest extends RequestOptions {
    credentialVersion?: number;
}

export const isCurrentAccountRequest = (request: AccountRequest): boolean =>
    request.credentialVersion !== undefined && request.credentialVersion === currentCredentialVersion();

export const unsignedRequests$ = Stream.create<RequestInput>();

export const makeSignedHTTPDriver = () => {
    const driver = makeHTTPDriver();
    return (requests$: Stream<RequestInput | null>) => driver(
        requests$
            .map((request) => Stream.fromPromise(authorizeRequest(request).then((authorized) => {
                const accountRequest = authorized as AccountRequest | null;
                const stale = accountRequest?.credentialVersion !== undefined && !isCurrentAccountRequest(accountRequest);
                if (request && (!authorized || stale)) { unsignedRequests$.shamefullySendNext(request); }
                return stale ? null : authorized;
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
    const version = currentCredentialVersion();
    const expectedVersion = (request as AccountRequest).credentialVersion;
    if (version === null) { return null; }
    const cancelled = () => version !== currentCredentialVersion()
        || (expectedVersion !== undefined && expectedVersion !== version) || isTwapActive?.() === false;
    if (cancelled()) { return null; }

    try {
        const body = request.send || "";
        const headers = typeof body === "string"
            ? await signRest(request.method || "GET", request.url.slice(origin.length), body)
            : null;
        if (!cancelled() && headers) {
            const authorized: AccountRequest = {
                ...request,
                credentialVersion: version,
                headers: Object.assign({}, request.headers, headers),
            };
            return authorized;
        }
    } catch {
        // eslint-disable-next-line no-console
        console.error("Unable to sign the bitFlyer request.");
    }
    if (!cancelled()) { onSigningFailure?.(); }
    return null;
};
